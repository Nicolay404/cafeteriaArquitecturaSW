import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createClient } from 'redis';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import {
  SessionStore,
  SessionStoreUnavailableError,
} from '../../apps/api/src/modules/identidad/sessions.js';

// T012 — sesiones opacas en Redis real (research D-01/D-02): token aleatorio, caducidad
// deslizante y absoluta, corte inmediato de todas las sesiones de una cuenta y CSRF.
const connect = async (url: string) => {
  const client = createClient({ url });
  await client.connect();
  return client;
};
const secret = 'solo_pruebas_locales_secreto_de_sesion';
const prefix = 'cafeteria:test:sesiones';

describe('T012 — sesiones con Redis real', () => {
  let infrastructure: Infrastructure;
  let clock = 1_800_000_000_000;
  let store: SessionStore;
  const cuenta = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

  async function raw<T>(operation: (client: Awaited<ReturnType<typeof connect>>) => Promise<T>) {
    const client = await connect(infrastructure.redisUrl);
    try {
      return await operation(client);
    } finally {
      client.destroy();
    }
  }

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    store = new SessionStore({
      redisUrl: infrastructure.redisUrl,
      prefix,
      secret,
      idleSeconds: 3600,
      absoluteSeconds: 7200,
      now: () => clock,
    });
  });
  afterAll(async () => {
    await store?.close();
    await infrastructure?.stop();
  });

  test('crea un token de 256 bits y la sesión se recupera con él', async () => {
    const { token, session } = await store.create({
      cuentaId: cuenta(1),
      rol: 'cliente',
      mfaVerificado: false,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.get(token)).toEqual(session);
    expect(session.csrf).not.toBe(token);
  });

  test('en Redis no queda el token: solo su HMAC', async () => {
    const { token } = await store.create({
      cuentaId: cuenta(1),
      rol: 'cliente',
      mfaVerificado: false,
    });
    const keys = await raw((client) => client.keys(`${prefix}:*`));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).not.toContain(token);
    const values = await raw(async (client) =>
      Promise.all(keys.filter((k) => !k.includes(':sesiones:')).map((k) => client.get(k))),
    );
    for (const value of values) expect(value ?? '').not.toContain(token);
  });

  test('un token inventado, vacío o con formato raro no abre nada', async () => {
    for (const token of [
      undefined,
      '',
      'corto',
      'a'.repeat(43),
      `${'a'.repeat(42)}!`,
      'a'.repeat(200),
    ])
      expect(await store.get(token)).toBeNull();
  });

  test('la inactividad caduca la sesión y cada uso la renueva', async () => {
    const { token } = await store.create({
      cuentaId: cuenta(2),
      rol: 'cliente',
      mfaVerificado: false,
    });
    const key = (await raw((client) => client.keys(`${prefix}:sesion:*`)))[0]!;
    await store.get(token);
    const ttl = await raw((client) => client.ttl(key));
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  test('la caducidad absoluta corta una sesión que se sigue usando', async () => {
    const { token } = await store.create({
      cuentaId: cuenta(3),
      rol: 'cliente',
      mfaVerificado: false,
    });
    clock += 7_100_000;
    expect(await store.get(token)).not.toBeNull();
    const ttl = await raw(async (client) => (await client.keys(`${prefix}:sesion:*`)).length);
    expect(ttl).toBeGreaterThan(0);
    clock += 200_000;
    expect(await store.get(token)).toBeNull();
    expect(await store.get(token)).toBeNull();
  });

  test('destroy cierra solo esa sesión', async () => {
    const a = await store.create({ cuentaId: cuenta(4), rol: 'cliente', mfaVerificado: false });
    const b = await store.create({ cuentaId: cuenta(4), rol: 'cliente', mfaVerificado: false });
    await store.destroy(a.token);
    expect(await store.get(a.token)).toBeNull();
    expect(await store.get(b.token)).not.toBeNull();
  });

  test('destroyAll corta TODAS las sesiones de la cuenta al instante y no las de otra', async () => {
    const mine = await Promise.all(
      [1, 2, 3].map(() =>
        store.create({ cuentaId: cuenta(5), rol: 'personal', mfaVerificado: true }),
      ),
    );
    const other = await store.create({ cuentaId: cuenta(6), rol: 'cliente', mfaVerificado: false });
    expect(await store.destroyAll(cuenta(5))).toBe(3);
    for (const { token } of mine) expect(await store.get(token)).toBeNull();
    expect(await store.get(other.token)).not.toBeNull();
  });

  test('destroyAll puede conservar la sesión actual (cambio de contraseña)', async () => {
    const current = await store.create({
      cuentaId: cuenta(7),
      rol: 'cliente',
      mfaVerificado: false,
    });
    const old = await store.create({ cuentaId: cuenta(7), rol: 'cliente', mfaVerificado: false });
    expect(await store.destroyAll(cuenta(7), current.token)).toBe(1);
    expect(await store.get(current.token)).not.toBeNull();
    expect(await store.get(old.token)).toBeNull();
  });

  test('update marca el segundo factor y la reautenticación sin alargar la sesión', async () => {
    const { token, session } = await store.create({
      cuentaId: cuenta(8),
      rol: 'admin',
      mfaVerificado: false,
    });
    const updated = await store.update(token, { mfaVerificado: true, autenticadoEn: clock + 5 });
    expect(updated).toMatchObject({
      mfaVerificado: true,
      autenticadoEn: clock + 5,
      csrf: session.csrf,
    });
    expect((await store.get(token))?.mfaVerificado).toBe(true);
    expect(await store.update('b'.repeat(43), { mfaVerificado: true })).toBeNull();
  });

  test('el token CSRF se compara en tiempo constante y exige igualdad exacta', async () => {
    const { session } = await store.create({
      cuentaId: cuenta(9),
      rol: 'cliente',
      mfaVerificado: false,
    });
    expect(store.verifyCsrf(session, session.csrf)).toBe(true);
    expect(store.verifyCsrf(session, undefined)).toBe(false);
    expect(store.verifyCsrf(session, '')).toBe(false);
    expect(store.verifyCsrf(session, `${session.csrf}x`)).toBe(false);
    expect(store.verifyCsrf(session, session.csrf.replace(/.$/, 'A'))).toBe(
      session.csrf.endsWith('A'),
    );
  });

  test('un secreto distinto no reconoce las sesiones de otro', async () => {
    const { token } = await store.create({
      cuentaId: cuenta(1),
      rol: 'cliente',
      mfaVerificado: false,
    });
    const stranger = new SessionStore({
      redisUrl: infrastructure.redisUrl,
      prefix,
      secret: `${secret}_otro_secreto_distinto`,
    });
    try {
      expect(await stranger.get(token)).toBeNull();
    } finally {
      await stranger.close();
    }
  });

  test('rechaza un secreto corto', () => {
    expect(() => new SessionStore({ redisUrl: 'redis://x', prefix, secret: 'corto' })).toThrow(
      /32/,
    );
  });

  test('con Redis sin respuesta falla cerrado y se recupera al volver', async () => {
    const { token } = await store.create({
      cuentaId: cuenta(1),
      rol: 'cliente',
      mfaVerificado: false,
    });
    await infrastructure.pause('redis', true);
    try {
      await expect(store.get(token)).rejects.toBeInstanceOf(SessionStoreUnavailableError);
      await expect(
        store.create({ cuentaId: cuenta(1), rol: 'cliente', mfaVerificado: false }),
      ).rejects.toBeInstanceOf(SessionStoreUnavailableError);
    } finally {
      await infrastructure.pause('redis', false);
    }
    expect(await store.get(token)).not.toBeNull();
  });
});
