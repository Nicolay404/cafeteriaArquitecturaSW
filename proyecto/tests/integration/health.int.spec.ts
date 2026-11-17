import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Dependency, Infrastructure } from './infrastructure.fixture.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = fileURLToPath(new URL('../../apps/api/src/main.ts', import.meta.url));
const version = 'a'.repeat(40);

describe('T009 — contrato HTTP real de salud, pendiente de T011', () => {
  let infrastructure: Infrastructure | undefined;
  let process: ChildProcess | undefined;
  let baseUrl = '';

  async function get(path: string) {
    return fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  }

  async function readiness(status: number, expected: string) {
    const started = performance.now();
    const response = await get('/health');
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toMatch(/application\/json/);
    const body = await response.text();
    expect(performance.now() - started).toBeLessThanOrEqual(3000);
    expect(JSON.parse(body)).toEqual({ status: expected, version });
    for (const secret of [
      infrastructure!.password,
      infrastructure!.databaseUrl,
      infrastructure!.redisUrl,
      infrastructure!.rabbitmqUrl,
    ]) {
      expect(body).not.toContain(secret);
      expect(JSON.stringify([...response.headers])).not.toContain(secret);
    }
  }

  beforeAll(async () => {
    // Fail explicitly, never skip or replace the absent API with a mock server.
    if (!existsSync(entrypoint))
      throw new Error('T011 pendiente: no existe apps/api/src/main.ts; contrato T009 en rojo');
    infrastructure = await startInfrastructure();
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const address = reservation.address();
    if (!address || typeof address === 'string')
      throw new Error('Puerto HTTP dinámico no disponible');
    const port = address.port;
    await new Promise<void>((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    baseUrl = `http://127.0.0.1:${port}`;
    process = spawn(globalThis.process.execPath, ['--import', 'tsx', entrypoint], {
      cwd: workspace,
      env: {
        ...globalThis.process.env,
        ...parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')),
        API_PORT: String(port),
        TSX_TSCONFIG_PATH: fileURLToPath(new URL('../../apps/api/tsconfig.json', import.meta.url)),
        APP_VERSION: version,
        DATABASE_URL: infrastructure.databaseUrl,
        REDIS_URL: infrastructure.redisUrl,
        RABBITMQ_URL: infrastructure.rabbitmqUrl,
      },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (process.exitCode !== null) throw new Error('El proceso API terminó antes de responder');
      try {
        if ((await get('/health/live')).status === 200) return;
      } catch {
        /* wait for startup */
      }
      await delay(100);
    }
    throw new Error('La API no inició en 30 segundos');
  });

  afterAll(async () => {
    try {
      if (process && process.exitCode === null) {
        const closed = once(process, 'exit');
        process.kill();
        await closed;
      }
    } finally {
      await infrastructure?.stop();
    }
  });

  test('200, versión exacta, no-store y sin detalles de infraestructura', async () => {
    await readiness(200, 'ok');
  });

  test('liveness responde 200 con infraestructura sana', async () => {
    expect((await get('/health/live')).status).toBe(200);
  });

  test.each<Dependency>(['postgres', 'redis', 'rabbitmq'])(
    '%s sin respuesta: 503 en 3s, liveness 200 y recuperación',
    async (dependency) => {
      await infrastructure!.pause(dependency, true);
      try {
        const pending = readiness(503, 'unavailable');
        // Attach the rejection handler immediately while checking independent liveness.
        await Promise.all([
          pending,
          (async () => expect((await get('/health/live')).status).toBe(200))(),
        ]);
      } finally {
        await infrastructure!.pause(dependency, false);
      }
      await readiness(200, 'ok');
    },
  );

  test('timeout total de 3s cuando las tres dependencias no responden', async () => {
    const dependencies: Dependency[] = ['postgres', 'redis', 'rabbitmq'];
    try {
      for (const dependency of dependencies) await infrastructure!.pause(dependency, true);
      await readiness(503, 'unavailable');
      expect((await get('/health/live')).status).toBe(200);
    } finally {
      for (const dependency of dependencies) await infrastructure!.pause(dependency, false);
    }
    await readiness(200, 'ok');
  });
});
