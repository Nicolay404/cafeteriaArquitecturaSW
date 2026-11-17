import { createConnection } from 'node:net';
import { readApiConfig } from '../apps/api/src/platform/config.js';
import { readWorkerConfig } from '../apps/worker/src/config.js';
import { port } from '../packages/config/src/env.js';
import type { Environment } from '../packages/config/src/env.js';
import { postgresProbe, redisProbe, rabbitmqProbe } from './infrastructure-probes.js';
import { cliEnvironment, isMain, requireLocal, safeError } from './local-environment.js';

async function smtp(host: string, smtpPort: number) {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port: smtpPort });
    let received = '';
    let quit = false;
    let finished = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP timeout'));
    }, 2000);
    socket.on('error', reject);
    socket.on('close', () => {
      clearTimeout(timer);
      if (!finished) reject(new Error('SMTP cerró antes de confirmar QUIT'));
    });
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString();
      if (!quit && /(^|\r\n)220[ -]/.test(received)) {
        quit = true;
        received = '';
        socket.write('QUIT\r\n');
      }
      if (quit && /(^|\r\n)221[ -]/.test(received)) {
        finished = true;
        socket.end();
        resolve();
      }
    });
  });
}

export async function checkInfrastructure(
  environment: Environment,
  report: (line: string) => void = console.log,
) {
  requireLocal(environment);
  const api = readApiConfig({ environment, envFile: null });
  const worker = readWorkerConfig({ environment, envFile: null });
  const mailpitPort = port(environment, 'MAILPIT_UI_PORT');
  const probes = {
    postgres: async () => {
      if ((await postgresProbe(api.databaseUrl)) !== 1) throw new Error('SQL');
    },
    redis: async () => {
      const result = await redisProbe(api.redisUrl);
      if (result.value !== 'technical' || result.deletedCount !== 1 || result.afterDelete !== null)
        throw new Error('Redis');
    },
    rabbitmq: async () => {
      const result = await rabbitmqProbe(api.rabbitmqUrl);
      if (
        result.received.correlationId !== result.sentCorrelationId ||
        result.received.payload !== 'technical-platform-test' ||
        result.empty !== false
      )
        throw new Error('AMQP');
    },
    mailpit: async () => {
      const host = worker.smtpHost.includes(':') ? `[${worker.smtpHost}]` : worker.smtpHost;
      const response = await fetch(`http://${host}:${mailpitPort}/readyz`, {
        redirect: 'error',
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error('Mailpit');
      await smtp(worker.smtpHost, worker.smtpPort);
    },
  };
  const names = Object.keys(probes) as (keyof typeof probes)[];
  const results = await Promise.allSettled(names.map((name) => probes[name]()));
  const failed: string[] = [];
  results.forEach((result, index) => {
    const name = names[index]!;
    report(`${result.status === 'fulfilled' ? 'OK' : 'ERROR'} ${name}`);
    if (result.status === 'rejected') failed.push(name);
  });
  if (failed.length) throw new Error(`Infraestructura no disponible: ${failed.join(', ')}`);
  return names;
}

if (isMain(import.meta.url)) {
  try {
    await checkInfrastructure(cliEnvironment());
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}
