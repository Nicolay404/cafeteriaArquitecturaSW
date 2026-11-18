import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { freshMigratedDatabase, insertAccount } from './database.fixture.js';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import {
  OneTimeTokens,
  TOKEN_TTL_SECONDS,
  hashToken,
} from '../../apps/api/src/modules/identidad/one-time-tokens.js';

// T016 — enlaces de un solo uso con Postgres real (research D-06): solo se guarda el hash, el
// canje es atómico y se explica por qué falla un enlace (usado, caducado, inválido).
describe('T016 — tokens de un solo uso', () => {
  let infrastructure: Infrastructure;
  let pool: Pool;
  let tokens: OneTimeTokens;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    ({ pool } = await freshMigratedDatabase(infrastructure, 't016'));
    tokens = new OneTimeTokens(pool);
  });
  afterAll(async () => {
    await pool?.end();
    await infrastructure?.stop();
  });

  test('el token tiene 256 bits y en la base solo está su SHA-256', async () => {
    const cuenta = await insertAccount(pool);
    const token = await tokens.issue(cuenta, 'confirmar_correo');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const { rows } = await pool.query<{ hash: string }>(
      'SELECT hash FROM identity.token_un_uso WHERE cuenta_id = $1',
      [cuenta],
    );
    expect(rows).toEqual([{ hash: hashToken(token) }]);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  test('se canjea una vez y devuelve la cuenta; el segundo intento dice «usado»', async () => {
    const cuenta = await insertAccount(pool);
    const token = await tokens.issue(cuenta, 'recuperar');
    expect(await tokens.redeem(token, 'recuperar')).toEqual({ ok: true, cuentaId: cuenta });
    expect(await tokens.redeem(token, 'recuperar')).toEqual({ ok: false, motivo: 'usado' });
  });

  test('un token solo vale para su finalidad', async () => {
    const cuenta = await insertAccount(pool);
    const token = await tokens.issue(cuenta, 'confirmar_correo');
    expect(await tokens.redeem(token, 'recuperar')).toEqual({ ok: false, motivo: 'invalido' });
    expect(await tokens.redeem(token, 'confirmar_correo')).toMatchObject({ ok: true });
  });

  test.each(['', 'corto', 'x'.repeat(43), `${'A'.repeat(42)}$`, 'A'.repeat(100)])(
    'un token inventado «%s» es inválido',
    async (token) => {
      expect(await tokens.redeem(token, 'recuperar')).toEqual({ ok: false, motivo: 'invalido' });
    },
  );

  test('caduca: pasado su tiempo dice «caducado» y no se canjea', async () => {
    const cuenta = await insertAccount(pool);
    const token = await tokens.issue(cuenta, 'recuperar', 1);
    await delay(1300);
    expect(await tokens.redeem(token, 'recuperar')).toEqual({ ok: false, motivo: 'caducado' });
  });

  test('pedir uno nuevo invalida el anterior de la misma finalidad, no los de otra', async () => {
    const cuenta = await insertAccount(pool);
    const first = await tokens.issue(cuenta, 'recuperar');
    const other = await tokens.issue(cuenta, 'confirmar_correo');
    const second = await tokens.issue(cuenta, 'recuperar');
    expect(await tokens.redeem(first, 'recuperar')).toEqual({ ok: false, motivo: 'usado' });
    expect(await tokens.redeem(second, 'recuperar')).toMatchObject({ ok: true });
    expect(await tokens.redeem(other, 'confirmar_correo')).toMatchObject({ ok: true });
  });

  test('los tokens de otra cuenta no se ven afectados', async () => {
    const a = await insertAccount(pool);
    const b = await insertAccount(pool);
    const tokenA = await tokens.issue(a, 'recuperar');
    await tokens.issue(b, 'recuperar');
    expect(await tokens.redeem(tokenA, 'recuperar')).toEqual({ ok: true, cuentaId: a });
  });

  test('es atómico: 20 canjes simultáneos del mismo enlace dejan pasar exactamente uno', async () => {
    const cuenta = await insertAccount(pool);
    const token = await tokens.issue(cuenta, 'invitacion');
    const results = await Promise.all(
      Array.from({ length: 20 }, () => tokens.redeem(token, 'invitacion')),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  test('las vigencias son 24 h, 30 min, 72 h y 24 h', async () => {
    expect(TOKEN_TTL_SECONDS).toEqual({
      confirmar_correo: 86_400,
      recuperar: 1_800,
      invitacion: 259_200,
      cambio_correo: 86_400,
    });
    const cuenta = await insertAccount(pool);
    await tokens.issue(cuenta, 'recuperar');
    const { rows } = await pool.query<{ segundos: number }>(
      `SELECT extract(epoch FROM caduca_en - now())::int AS segundos
         FROM identity.token_un_uso WHERE cuenta_id = $1`,
      [cuenta],
    );
    expect(rows[0]!.segundos).toBeGreaterThan(1790);
    expect(rows[0]!.segundos).toBeLessThanOrEqual(1800);
  });

  test('borrar la cuenta borra sus tokens', async () => {
    const cuenta = await insertAccount(pool);
    await tokens.issue(cuenta, 'recuperar');
    await pool.query('DELETE FROM identity.cuenta WHERE id = $1', [cuenta]);
    const { rows } = await pool.query('SELECT 1 FROM identity.token_un_uso WHERE cuenta_id = $1', [
      cuenta,
    ]);
    expect(rows).toHaveLength(0);
  });
});
