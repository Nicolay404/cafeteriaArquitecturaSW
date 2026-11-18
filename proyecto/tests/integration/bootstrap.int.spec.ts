import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { checkInfrastructure } from '../../scripts/infra-check.js';
import { startDevelopment } from '../../scripts/dev.js';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No hay puerto');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe('T015 — arranque coordinado e infraestructura', () => {
  let infra: Infrastructure;
  let mailpit: StartedTestContainer | undefined;
  let environment: Record<string, string>;
  beforeAll(async () => {
    infra = await startInfrastructure();
    mailpit = await new GenericContainer(
      'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce',
    )
      .withEnvironment({ MP_SMTP_DISABLE_RDNS: 'true' })
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
    const apiPort = await freePort();
    const webPort = await freePort();
    environment = {
      ...parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')),
      DATABASE_URL: infra.databaseUrl,
      REDIS_URL: infra.redisUrl,
      RABBITMQ_URL: infra.rabbitmqUrl,
      SMTP_HOST: mailpit.getHost(),
      SMTP_PORT: String(mailpit.getMappedPort(1025)),
      MAILPIT_UI_PORT: String(mailpit.getMappedPort(8025)),
      API_PORT: String(apiPort),
      WEB_PORT: String(webPort),
      API_BASE_URL: `http://127.0.0.1:${apiPort}`,
      WEB_ORIGIN: `http://127.0.0.1:${webPort}`,
    };
  });
  afterAll(async () => {
    try {
      await mailpit?.stop();
    } finally {
      await infra?.stop();
    }
  });

  test('SQL, Redis write/read/delete, Rabbit correlacionado y Mailpit HTTP/SMTP reales', async () => {
    expect(await checkInfrastructure(environment, () => {})).toEqual([
      'postgres',
      'redis',
      'rabbitmq',
      'mailpit',
    ]);
  });
  test('un fallo de dependencia se informa sin credenciales', async () => {
    await infra.pause('redis', true);
    try {
      await expect(checkInfrastructure(environment, () => {})).rejects.toThrow('redis');
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'scripts/infra-check.ts', '--env-file', '.env.example'],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          env: { ...process.env, ...environment },
          encoding: 'utf8',
          timeout: 20_000,
          windowsHide: true,
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('ERROR redis');
      expect(result.stdout + result.stderr).not.toContain(infra.password);
    } finally {
      await infra.pause('redis', false);
    }
  });
  test('web/API/worker arrancan juntos y se detienen sin dejar puertos ocupados', async () => {
    const development = await startDevelopment(environment, false);
    try {
      expect((await fetch(`${environment['WEB_ORIGIN']}/`)).status).toBe(200);
      const response = await fetch(`${environment['WEB_ORIGIN']}/api/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', version: 'local' });
    } finally {
      await development.stop();
    }
    for (const name of ['API_PORT', 'WEB_PORT']) {
      const listener = createServer();
      listener.listen(Number(environment[name]), '127.0.0.1');
      await once(listener, 'listening');
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });
  test('rechaza puerto ocupado antes de crear procesos', async () => {
    const server = createServer();
    server.listen(Number(environment['API_PORT']), '127.0.0.1');
    await once(server, 'listening');
    try {
      await expect(startDevelopment(environment, false)).rejects.toThrow('API_PORT');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test('una cancelación ya solicitada no deja procesos iniciados', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(startDevelopment(environment, false, controller.signal)).rejects.toThrow(
      'Arranque cancelado',
    );
  });
});
