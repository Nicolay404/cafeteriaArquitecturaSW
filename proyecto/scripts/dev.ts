import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readApiConfig } from '../apps/api/src/platform/config.js';
import { readWebConfig } from '../apps/web/src/server/config.js';
import type { Environment } from '../packages/config/src/env.js';
import { ConfigurationError } from '../packages/config/src/env.js';
import { checkInfrastructure } from './infra-check.js';
import { within } from './infrastructure-probes.js';
import { cliEnvironment, isMain, requireLocal, safeError } from './local-environment.js';

async function assertFreePort(value: number, name: string) {
  const reservation = createServer();
  try {
    reservation.listen(value, '127.0.0.1');
    await once(reservation, 'listening');
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
  } catch {
    throw new ConfigurationError(name);
  }
}

export async function startDevelopment(
  environment: Environment,
  output = true,
  signal?: AbortSignal,
) {
  requireLocal(environment);
  const api = readApiConfig({ environment, envFile: null });
  const web = readWebConfig({ environment, envFile: null });
  if (api.port === web.port || Number(new URL(web.apiBaseUrl).port || 80) !== api.port)
    throw new ConfigurationError('API_PORT');
  if (Number(new URL(web.origin).port || 80) !== web.port) throw new ConfigurationError('WEB_PORT');
  await assertFreePort(api.port, 'API_PORT');
  await assertFreePort(web.port, 'WEB_PORT');
  await checkInfrastructure(environment, output ? console.log : () => {});
  const cwd = fileURLToPath(new URL('../', import.meta.url));
  const children: ChildProcess[] = [];
  const exited: Promise<unknown>[] = [];
  let shutdown: Promise<void> | undefined;
  let failure: Error | undefined;
  let workerReady = false;
  let resolveCompletion: (code: number) => void = () => {};
  const completion = new Promise<number>((resolve) => {
    resolveCompletion = resolve;
  });
  const stop = () => {
    if (shutdown) return shutdown;
    shutdown = (async () => {
      signal?.removeEventListener('abort', cancel);
      for (const child of children) if (child.connected) child.send('shutdown', () => {});
      try {
        await within(Promise.all(exited), 7000);
      } catch {
        for (const child of children) if (child.exitCode === null) child.kill();
        await within(Promise.all(exited), 3000);
      }
      resolveCompletion(failure ? 1 : 0);
    })();
    return shutdown;
  };
  const cancel = () => {
    void stop().catch(() => {
      resolveCompletion(1);
    });
  };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) throw new Error('Arranque cancelado');
    for (const service of ['api', 'worker', 'web']) {
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./process-entry.ts', import.meta.url)), service],
        {
          cwd,
          env: {
            ...process.env,
            ...environment,
            TSX_TSCONFIG_PATH: `${cwd}/apps/${service}/tsconfig.json`,
            NEXT_TELEMETRY_DISABLED: '1',
          },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
      );
      children.push(child);
      exited.push(
        new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.once('error', () => resolve());
        }),
      );
      const unavailable = () => {
        if (!shutdown) {
          failure = new Error(`Proceso local terminó: ${service}`);
          void stop();
        }
      };
      child.once('exit', unavailable);
      child.once('error', unavailable);
      child.stdout!.on('data', (chunk: Buffer) => {
        if (service === 'worker' && chunk.toString().includes('"worker_ready"')) workerReady = true;
        if (output) process.stdout.write(chunk);
      });
      child.stderr!.on('data', (chunk: Buffer) => {
        if (output) process.stderr.write(chunk);
      });
    }
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('Arranque cancelado');
      if (failure) throw failure;
      try {
        const responses = await Promise.all([
          fetch(`${web.apiBaseUrl}/health`, { signal: AbortSignal.timeout(1500) }),
          fetch(web.origin, { signal: AbortSignal.timeout(1500) }),
        ]);
        if (workerReady && responses.every((response) => response.ok)) return { stop, completion };
      } catch {
        /* children are still starting */
      }
      await delay(100);
    }
    throw new Error('El entorno local no inició a tiempo');
  } catch (error) {
    await stop();
    throw error;
  }
}

if (isMain(import.meta.url)) {
  const cancellation = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => cancellation.abort());
  try {
    const development = await startDevelopment(cliEnvironment(), true, cancellation.signal);
    console.log('DEV_READY web/API/worker');
    process.exitCode = await development.completion;
  } catch (error) {
    console.error(safeError(error));
    process.exitCode = 1;
  }
}
