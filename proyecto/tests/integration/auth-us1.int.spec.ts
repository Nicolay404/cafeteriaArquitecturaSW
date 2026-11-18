import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createClient } from 'redis';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';
import type { Pool } from 'pg';
import { freshMigratedDatabase } from './database.fixture.js';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { createApp } from '../../apps/api/src/composition/app.js';
import { setFlag } from '../../scripts/flags-set.js';

// T017 — US1 de punta a punta por HTTP con Postgres, Redis y Mailpit reales: registro, confirmación,
// acceso, cierre, recuperación, límites y respuestas que no revelan si un correo existe.
const example = parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8'));
const prefix = 'cafeteria:test';
const PASSWORD = 'cafe con leche y pan tostado';
const NEW_PASSWORD = 'una frase nueva bastante larga';
const fixedUa = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0';

interface Mail {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

describe('T017 — US1 por HTTP con servicios reales', () => {
  let infrastructure: Infrastructure;
  let mailpit: StartedTestContainer;
  let created: Awaited<ReturnType<typeof createApp>>;
  let pool: Pool;
  let base = '';
  let ui = '';
  let counter = 0;

  const email = () => `cliente${++counter}@ejemplo.com`;

  async function api(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      cookie?: string;
      csrf?: string;
      forwardedFor?: string;
    } = {},
  ) {
    const response = await fetch(`${base}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': fixedUa,
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...(init.csrf ? { 'x-csrf-token': init.csrf } : {}),
        ...(init.forwardedFor ? { 'x-forwarded-for': init.forwardedFor } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  const mails = async (to: string): Promise<Mail[]> => {
    await created.mail.idle();
    const list = (await (await fetch(`${ui}/api/v1/messages`)).json()) as { messages: Mail[] };
    return list.messages.filter((message) => message.To[0]?.Address === to);
  };
  const mailText = async (message: Mail) =>
    ((await (await fetch(`${ui}/api/v1/message/${message.ID}`)).json()) as { Text: string }).Text;
  const tokenFrom = async (to: string, subject: string) => {
    const message = (await mails(to)).find((item) => item.Subject === subject);
    expect(message).toBeDefined();
    const match = /token=([A-Za-z0-9_-]{43})/.exec(await mailText(message!));
    expect(match).not.toBeNull();
    return match![1]!;
  };

  async function clearLimits() {
    const redis = createClient({ url: infrastructure.redisUrl });
    await redis.connect();
    try {
      const keys = await redis.keys(`${prefix}:limite:*`);
      if (keys.length > 0) await redis.del(keys);
    } finally {
      redis.destroy();
    }
  }

  const register = (correo: string, extra: Record<string, unknown> = {}) =>
    api('/api/auth/registro', {
      body: { nombre: 'Ana Pérez', correo, contrasena: PASSWORD, aceptaPolitica: true, ...extra },
    });
  async function activeAccount() {
    const correo = email();
    expect((await register(correo)).status).toBe(202);
    const token = await tokenFrom(correo, 'Confirma tu correo');
    expect((await api('/api/auth/confirmar-correo', { body: { token } })).status).toBe(204);
    return correo;
  }
  const login = (correo: string, contrasena = PASSWORD) =>
    api('/api/auth/acceso', { body: { correo, contrasena } });
  const cookieOf = (headers: Headers) => /(sid=[^;]+)/.exec(headers.get('set-cookie') ?? '')?.[1];

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    mailpit = await new GenericContainer(
      'axllent/mailpit:v1.33.1@sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce',
    )
      .withEnvironment({ MP_SMTP_DISABLE_RDNS: 'true' })
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
    ui = `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`;
    const database = await freshMigratedDatabase(infrastructure, 't017');
    pool = database.pool;
    created = await createApp({
      version: 'it',
      appEnv: 'local',
      webOrigin: 'http://127.0.0.1:3000',
      databaseUrl: database.databaseUrl,
      redisUrl: infrastructure.redisUrl,
      rabbitmqUrl: infrastructure.rabbitmqUrl,
      flagsPrefix: `${prefix}:flags`,
      smtpHost: mailpit.getHost(),
      smtpPort: mailpit.getMappedPort(1025),
      piiKeys: { 1: example['PII_KEY_1']! },
      piiIndexKey: example['PII_INDEX_KEY']!,
      sessionSecret: example['SESSION_SECRET']!,
      hibpEnabled: false,
    });
    await created.app.listen(0, '127.0.0.1');
    base = await created.app.getUrl();
    await setFlag({
      redisUrl: infrastructure.redisUrl,
      prefix: `${prefix}:flags`,
      key: 'identidad-habilitada',
      enabled: true,
    });
  });
  afterAll(async () => {
    await created?.app.close();
    await pool?.end();
    await mailpit?.stop();
    await infrastructure?.stop();
  });
  beforeEach(clearLimits);

  test('registro → correo → no entra sin confirmar → confirma → entra → sesión → cierre', async () => {
    const correo = email();
    const registro = await register(correo);
    expect(registro.status).toBe(202);

    const unconfirmed = await login(correo);
    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body['codigo']).toBe('correo_sin_confirmar');

    const token = await tokenFrom(correo, 'Confirma tu correo');
    expect((await api('/api/auth/confirmar-correo', { body: { token } })).status).toBe(204);

    const entrada = await login(correo);
    expect(entrada.status).toBe(200);
    expect(entrada.body['requiereMfa']).toBe(false);
    const setCookie = entrada.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(/^sid=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(entrada.headers.get('cache-control')).toBe('no-store');
    const cookie = cookieOf(entrada.headers)!;
    const csrf = entrada.body['csrf'] as string;

    const sesion = await api('/api/auth/sesion', { method: 'GET', cookie });
    expect(sesion.body).toMatchObject({ rol: 'cliente', nombre: 'Ana Pérez', mfaVerificado: true });

    expect((await api('/api/auth/cierre', { cookie })).status).toBe(403);
    expect((await api('/api/auth/cierre', { cookie })).body['codigo']).toBe('csrf_invalido');
    expect((await api('/api/auth/cierre', { cookie, csrf })).status).toBe(204);
    expect((await api('/api/auth/sesion', { method: 'GET', cookie })).status).toBe(401);
  });

  test('el enlace de confirmación sirve una sola vez y el segundo uso explica qué hacer', async () => {
    const correo = email();
    await register(correo);
    const token = await tokenFrom(correo, 'Confirma tu correo');
    await api('/api/auth/confirmar-correo', { body: { token } });
    const again = await api('/api/auth/confirmar-correo', { body: { token } });
    expect(again.status).toBe(410);
    expect(again.body['codigo']).toBe('enlace_usado');
    expect(again.body['mensaje']).toMatch(/Pide uno nuevo/);
  });

  test('registrarse con un correo existente responde igual y avisa al titular, sin duplicar', async () => {
    const correo = email();
    const first = await register(correo);
    const second = await register(correo, { nombre: 'Otra Persona' });
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    const { rows } = await pool.query(
      'SELECT 1 FROM identity.cuenta c JOIN customers.persona p ON p.id = c.persona_id',
    );
    expect(rows.length).toBeGreaterThan(0);
    const subjects = (await mails(correo)).map((message) => message.Subject).sort();
    expect(subjects).toEqual(['Alguien intentó registrarse con tu correo', 'Confirma tu correo']);
  });

  test('dos registros simultáneos con el mismo correo crean una sola cuenta', async () => {
    const correo = email();
    const results = await Promise.all([register(correo), register(correo)]);
    expect(results.map((result) => result.status)).toEqual([202, 202]);
    const { rows } = await pool.query<{ total: string }>(
      'SELECT count(*) AS total FROM customers.persona WHERE eliminada_en IS NULL',
    );
    expect(Number(rows[0]!.total)).toBeGreaterThan(0);
    const accounts = await pool.query(
      'SELECT 1 FROM identity.cuenta WHERE persona_id IN (SELECT id FROM customers.persona)',
    );
    const personas = await pool.query('SELECT 1 FROM customers.persona');
    expect(personas.rowCount).toBe(accounts.rowCount);
  });

  test('en la base no queda ningún dato personal en claro', async () => {
    const correo = email();
    await register(correo, { nombre: 'Valentina Ñandú' });
    const dump = JSON.stringify([
      (await pool.query('SELECT * FROM customers.persona')).rows,
      (await pool.query('SELECT * FROM identity.cuenta')).rows,
      (await pool.query('SELECT * FROM identity.evento_seguridad')).rows,
    ]);
    expect(dump).not.toContain(correo);
    expect(dump).not.toContain('Valentina');
    expect(dump).not.toContain(PASSWORD);
    expect(dump).toContain('$argon2id$');
  });

  test('contraseña incorrecta y cuenta inexistente dan exactamente la misma respuesta', async () => {
    const correo = await activeAccount();
    const wrong = await login(correo, 'otra contraseña distinta');
    const unknown = await login('nadie@ejemplo.com', 'otra contraseña distinta');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  test('tras 5 fallos bloquea con Retry-After, avisa una sola vez y ni la contraseña correcta pasa', async () => {
    const correo = await activeAccount();
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await login(correo, 'incorrecta número ' + attempt)).status).toBe(401);
    const blocked = await login(correo, PASSWORD);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(800);
    expect(blocked.body['codigo']).toBe('demasiados_intentos');
    await login(correo, PASSWORD);
    await login(correo, PASSWORD);
    const notices = (await mails(correo)).filter((message) =>
      message.Subject.startsWith('Bloqueamos'),
    );
    expect(notices).toHaveLength(1);
  });

  test('bloquear una cuenta que no existe no manda correo a nadie', async () => {
    const ghost = 'fantasma@ejemplo.com';
    for (let attempt = 0; attempt < 6; attempt++) await login(ghost, 'x'.repeat(14) + attempt);
    expect(await mails(ghost)).toEqual([]);
  });

  test('el registro por IP también se limita (5 por hora)', async () => {
    for (let attempt = 0; attempt < 5; attempt++)
      expect((await register(email())).status).toBe(202);
    const sixth = await register(email());
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get('retry-after')).not.toBeNull();
  });

  test('recuperar: enlace de un solo uso; una contraseña débil no lo gasta; el éxito corta las sesiones', async () => {
    const correo = await activeAccount();
    const session = await login(correo);
    const cookie = cookieOf(session.headers)!;

    expect((await api('/api/auth/recuperar', { body: { correo } })).status).toBe(202);
    const token = await tokenFrom(correo, 'Recupera tu contraseña');

    const weak = await api('/api/auth/restablecer', {
      body: { token, contrasena: 'Password1234' },
    });
    expect(weak.status).toBe(400);
    expect(weak.body['campos']).toEqual([
      { campo: 'contrasena', mensaje: expect.stringMatching(/común/) },
    ]);

    expect(
      (await api('/api/auth/restablecer', { body: { token, contrasena: NEW_PASSWORD } })).status,
    ).toBe(204);
    expect(
      (await api('/api/auth/restablecer', { body: { token, contrasena: NEW_PASSWORD } })).body[
        'codigo'
      ],
    ).toBe('enlace_usado');

    expect((await api('/api/auth/sesion', { method: 'GET', cookie })).status).toBe(401);
    expect((await login(correo, PASSWORD)).status).toBe(401);
    expect((await login(correo, NEW_PASSWORD)).status).toBe(200);
  });

  test('recuperar responde igual exista o no la cuenta y no manda correo a un extraño', async () => {
    const existing = await activeAccount();
    const a = await api('/api/auth/recuperar', { body: { correo: existing } });
    const b = await api('/api/auth/recuperar', { body: { correo: 'ninguno@ejemplo.com' } });
    expect(b.status).toBe(a.status);
    expect(b.body).toEqual(a.body);
    expect(await mails('ninguno@ejemplo.com')).toEqual([]);
  });

  test('un enlace de recuperación caducado explica qué hacer', async () => {
    const correo = await activeAccount();
    await api('/api/auth/recuperar', { body: { correo } });
    const token = await tokenFrom(correo, 'Recupera tu contraseña');
    await pool.query(
      `UPDATE identity.token_un_uso SET caduca_en = now() - interval '1 minute' WHERE proposito = 'recuperar'`,
    );
    const result = await api('/api/auth/restablecer', {
      body: { token, contrasena: NEW_PASSWORD },
    });
    expect(result.status).toBe(410);
    expect(result.body['codigo']).toBe('enlace_caducado');
  });

  test('reenviar la confirmación manda un enlace nuevo solo a cuentas pendientes', async () => {
    const correo = email();
    await register(correo);
    const before = (await mails(correo)).length;
    expect((await api('/api/auth/reenviar-confirmacion', { body: { correo } })).status).toBe(202);
    expect(await mails(correo)).toHaveLength(before + 1);
    const active = await activeAccount();
    const count = (await mails(active)).length;
    await api('/api/auth/reenviar-confirmacion', { body: { correo: active } });
    expect(await mails(active)).toHaveLength(count);
  });

  test('los errores del formulario dicen qué campo falla y cómo corregirlo', async () => {
    const result = await api('/api/auth/registro', {
      body: { nombre: '', correo: 'sin-arroba', contrasena: 'corta', aceptaPolitica: false },
    });
    expect(result.status).toBe(400);
    const campos = result.body['campos'] as { campo: string; mensaje: string }[];
    expect(campos.map((item) => item.campo).sort()).toEqual(
      ['aceptaPolitica', 'contrasena', 'correo', 'nombre'].sort(),
    );
    for (const item of campos) expect(item.mensaje.length).toBeGreaterThan(10);
  });

  test('con el flag apagado las rutas no existen (404) y vuelven al encenderlo', async () => {
    const flag = {
      redisUrl: infrastructure.redisUrl,
      prefix: `${prefix}:flags`,
      key: 'identidad-habilitada' as const,
    };
    await setFlag({ ...flag, enabled: false });
    try {
      expect((await register(email())).status).toBe(404);
      expect((await login('a@ejemplo.com')).status).toBe(404);
    } finally {
      await setFlag({ ...flag, enabled: true });
    }
    expect((await register(email())).status).toBe(202);
  });

  test('detrás de la web, la IP del visitante sale de X-Forwarded-For (solo desde una red privada)', async () => {
    await api('/api/auth/acceso', {
      body: { correo: 'ip@ejemplo.com', contrasena: 'cualquiera' },
      forwardedFor: '203.0.113.9',
    });
    const { rows } = await pool.query<{ ip_truncada: string }>(
      "SELECT ip_truncada FROM identity.evento_seguridad WHERE tipo = 'acceso_fallido' ORDER BY creado_en DESC LIMIT 1",
    );
    expect(rows[0]?.ip_truncada).toBe('203.0.113.0/24');
  });

  test('los eventos de seguridad quedan registrados sin contraseñas, tokens ni correos', async () => {
    const correo = await activeAccount();
    await login(correo, 'incorrecta para el evento');
    await login(correo);
    const { rows } = await pool.query<{
      tipo: string;
      ip_truncada: string | null;
      agente: string | null;
    }>('SELECT tipo, ip_truncada, agente FROM identity.evento_seguridad ORDER BY creado_en');
    const types = new Set(rows.map((row) => row.tipo));
    expect(types).toEqual(
      expect.objectContaining(new Set(['registro', 'acceso_fallido', 'acceso_ok'])),
    );
    expect(
      rows.filter((row) => row.agente !== null).every((row) => row.agente === 'Chrome / Windows'),
    ).toBe(true);
    expect(rows.some((row) => row.agente === 'Chrome / Windows')).toBe(true);
    expect(
      rows.every((row) => row.ip_truncada === null || /\.0\/24$|::\/48$/.test(row.ip_truncada)),
    ).toBe(true);
    const dump = JSON.stringify((await pool.query('SELECT * FROM identity.evento_seguridad')).rows);
    expect(dump).not.toContain(correo);
    expect(dump).not.toContain('incorrecta para el evento');
  });
});
