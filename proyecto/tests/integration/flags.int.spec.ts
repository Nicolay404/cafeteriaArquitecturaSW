import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createClient } from 'redis';
import { setTimeout as delay } from 'node:timers/promises';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { createPlatformApp } from '../../apps/api/src/platform/platform.module.js';
import { FlagsService, TECHNICAL_FLAGS } from '../../apps/api/src/platform/flags.service.js';
import { authorizeFlagWrite, setFlag } from '../../scripts/flags-set.js';

// T050 — US4/FR-005: flags técnicos en Redis, leídos en runtime, sin redeploy y con valor
// seguro (apagado) ante cualquier fallo. Solo el CLI local escribe; la API no tiene ruta de
// escritura. Sin panel público ni lógica de negocio.
const FLAG = 'capacidad-tecnica-de-prueba';
const prefix = 'cafeteria:test:flags';

describe('T050 — flags técnicos con Redis real', () => {
  let infrastructure: Infrastructure;
  let app: Awaited<ReturnType<typeof createPlatformApp>>;
  let baseUrl = '';

  const capability = () => fetch(`${baseUrl}/platform/capacidad-prueba`);
  const write = (enabled: boolean) =>
    setFlag({ redisUrl: infrastructure.redisUrl, prefix, key: FLAG, enabled });

  async function rawHash(key = FLAG) {
    const redis = createClient({ url: infrastructure.redisUrl });
    await redis.connect();
    try {
      return await redis.hGetAll(`${prefix}:${key}`);
    } finally {
      redis.destroy();
    }
  }

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    const config = {
      version: 'flags-test',
      databaseUrl: infrastructure.databaseUrl,
      redisUrl: infrastructure.redisUrl,
      rabbitmqUrl: infrastructure.rabbitmqUrl,
      flagsPrefix: prefix,
    };
    app = await createPlatformApp(config);
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });
  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await infrastructure?.stop();
    }
  });

  test('la lista de claves permitidas es explícita y mínima', () => {
    expect([...TECHNICAL_FLAGS]).toEqual([FLAG]);
  });

  test('sin valor, el flag está apagado y la capacidad se oculta', async () => {
    const response = await capability();
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await rawHash()).toEqual({});
  });

  test('encender y apagar se refleja en la API en marcha, sin redeploy, con revisión y fecha', async () => {
    const on = await write(true);
    expect(on).toMatchObject({ key: FLAG, enabled: true, revision: 1 });
    expect(new Date(on.changedAt).toISOString()).toBe(on.changedAt);
    const enabled = await capability();
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ capacidad: 'prueba-tecnica', habilitada: true });

    const off = await write(false);
    expect(off).toMatchObject({ enabled: false, revision: 2 });
    expect((await capability()).status).toBe(404);
    expect(await rawHash()).toMatchObject({ enabled: 'false', revision: '2' });
  });

  test('rechaza una clave no permitida sin escribir nada', async () => {
    await expect(
      setFlag({ redisUrl: infrastructure.redisUrl, prefix, key: 'cualquier-cosa', enabled: true }),
    ).rejects.toThrow('permitida');
    expect(await rawHash('cualquier-cosa')).toEqual({});
  });

  test('rechaza un valor que no es booleano', async () => {
    await expect(
      setFlag({
        redisUrl: infrastructure.redisUrl,
        prefix,
        key: FLAG,
        enabled: 'si' as unknown as boolean,
      }),
    ).rejects.toThrow('booleano');
    expect((await rawHash()).enabled).toBe('false');
  });

  test('la API no ofrece ninguna ruta de escritura', async () => {
    await write(false);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${baseUrl}/platform/capacidad-prueba`, {
        method,
        body: method === 'DELETE' ? null : JSON.stringify({ enabled: true }),
        headers: { 'content-type': 'application/json' },
      });
      expect([404, 405]).toContain(response.status);
    }
    expect((await rawHash()).enabled).toBe('false');
    expect((await capability()).status).toBe(404);
  });

  test('un valor corrupto en Redis se trata como apagado', async () => {
    const redis = createClient({ url: infrastructure.redisUrl });
    await redis.connect();
    try {
      await redis.hSet(`${prefix}:${FLAG}`, {
        enabled: 'quizás',
        revision: 'x',
        changedAt: 'ayer',
      });
    } finally {
      redis.destroy();
    }
    expect((await capability()).status).toBe(404);
    expect(
      await new FlagsService({ redisUrl: infrastructure.redisUrl, flagsPrefix: prefix }).isEnabled(
        FLAG,
      ),
    ).toBe(false);
    // Un valor dañado no impide volver a escribir: la revisión se reinicia desde 1.
    expect(await write(true)).toMatchObject({ enabled: true, revision: 1 });
  });

  test('con Redis sin respuesta el flag falla apagado y se recupera al volver', async () => {
    await write(true);
    expect((await capability()).status).toBe(200);

    await infrastructure.pause('redis', true);
    try {
      const started = performance.now();
      const response = await capability();
      expect(response.status).toBe(404);
      expect(performance.now() - started).toBeLessThan(2500);
    } finally {
      await infrastructure.pause('redis', false);
    }
    expect((await capability()).status).toBe(200);
  });

  test('el valor persiste tras reiniciar Redis', async () => {
    await write(true);
    const before = await rawHash();
    await infrastructure.containers.redis.restart({ timeout: 20_000 });
    await delay(500);
    // El puerto publicado puede cambiar: se vuelve a leer con la URL recalculada.
    const service = new FlagsService({ redisUrl: infrastructure.redisUrl, flagsPrefix: prefix });
    expect(await service.isEnabled(FLAG)).toBe(true);
    expect(await rawHash()).toEqual(before);
  });
});

describe('T050 — quién puede escribir', () => {
  const local = { APP_ENV: 'local', REDIS_URL: 'redis://127.0.0.1:6379' };

  test('se permite en un entorno local con Redis local', () => {
    expect(() => authorizeFlagWrite(local)).not.toThrow();
  });

  test.each([
    ['staging', { ...local, APP_ENV: 'staging' }],
    ['producción', { ...local, APP_ENV: 'production' }],
    [
      'un Redis remoto aunque diga local',
      { ...local, REDIS_URL: 'redis://redis.ejemplo.test:6379' },
    ],
    ['sin APP_ENV', { REDIS_URL: local.REDIS_URL }],
  ])('se rechaza en %s sin identidad de pipeline', (_nombre, environment) => {
    expect(() => authorizeFlagWrite(environment)).toThrow();
  });
});
