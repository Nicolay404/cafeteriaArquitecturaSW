import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { migrate } from '../../scripts/db/migrate.js';

// T005/T006 — esquemas `identity` y `customers` con Postgres real: se aplican con el runner,
// son idempotentes, imponen sus restricciones y no guardan PII en claro.
const directory = fileURLToPath(new URL('../../infra/migrations/', import.meta.url));

describe('T005/T006 — esquemas identity y customers', () => {
  let infrastructure: Infrastructure;
  let url = '';
  let client: Client;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    const name = `t005_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: infrastructure.databaseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    await admin.end();
    const parsed = new URL(infrastructure.databaseUrl);
    parsed.pathname = `/${name}`;
    url = parsed.toString();
    await migrate({ databaseUrl: url, directory });
    client = new Client({ connectionString: url });
    await client.connect();
  });
  afterAll(async () => {
    await client?.end();
    await infrastructure?.stop();
  });

  const cuenta = (overrides: Record<string, unknown> = {}) => {
    const values: Record<string, unknown> = {
      persona_id: randomUUID(),
      indice_correo: randomUUID(),
      rol: 'cliente',
      estado: 'pendiente',
      correo_confirmado_en: null,
      ...overrides,
    };
    return client.query(
      `INSERT INTO identity.cuenta (persona_id, indice_correo, rol, estado, correo_confirmado_en)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        values['persona_id'],
        values['indice_correo'],
        values['rol'],
        values['estado'],
        values['correo_confirmado_en'],
      ],
    );
  };

  test('la segunda ejecución no aplica nada (idempotente)', async () => {
    const again = await migrate({ databaseUrl: url, directory });
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toEqual(expect.arrayContaining(['010', '011']));
  });

  test('ninguna columna guarda PII en claro: solo índice ciego o columnas *_cifrado', async () => {
    const { rows } = await client.query<{ table_schema: string; column_name: string }>(
      `SELECT table_schema, column_name FROM information_schema.columns
       WHERE table_schema IN ('identity', 'customers')`,
    );
    const sensibles = rows.filter(({ column_name }) =>
      /^(nombre|correo|email|telefono|preferencias)$/.test(column_name),
    );
    expect(sensibles).toEqual([]);
    const pii = rows
      .filter(({ table_schema }) => table_schema === 'customers')
      .map(({ column_name }) => column_name)
      .filter((name) => /nombre|correo|telefono|preferencias/.test(name));
    expect(pii.length).toBeGreaterThan(0);
    for (const name of pii) expect(name).toMatch(/_cifrad[oa]s?$/);
  });

  test('el índice del correo es único y el rol y el estado son cerrados', async () => {
    const indice = randomUUID();
    await cuenta({ indice_correo: indice });
    await expect(cuenta({ indice_correo: indice })).rejects.toThrow(/duplicate key/);
    await expect(cuenta({ rol: 'superusuario' })).rejects.toThrow(/check constraint/);
    await expect(cuenta({ estado: 'borrada' })).rejects.toThrow(/check constraint/);
  });

  test('una cuenta activa exige el correo confirmado', async () => {
    await expect(cuenta({ estado: 'activa' })).rejects.toThrow(/cuenta_activa_confirmada/);
    await expect(
      cuenta({ estado: 'activa', correo_confirmado_en: new Date().toISOString() }),
    ).resolves.toBeDefined();
  });

  test('los eventos de seguridad son de solo inserción', async () => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO identity.evento_seguridad (tipo, ip_truncada) VALUES ('registro', '203.0.113.0/24')
       RETURNING id`,
    );
    const id = rows[0]!.id;
    await expect(
      client.query(`UPDATE identity.evento_seguridad SET tipo = 'acceso_ok' WHERE id = $1`, [id]),
    ).rejects.toThrow(/solo inserción/);
    await expect(
      client.query('DELETE FROM identity.evento_seguridad WHERE id = $1', [id]),
    ).rejects.toThrow(/solo inserción/);
    await expect(
      client.query(`INSERT INTO identity.evento_seguridad (tipo) VALUES ('inventado')`),
    ).rejects.toThrow(/check constraint/);
  });

  test('un token solo se guarda por su hash y los hashes no se repiten', async () => {
    const { rows } = await cuenta();
    const insert = (hash: string) =>
      client.query(
        `INSERT INTO identity.token_un_uso (cuenta_id, proposito, hash, caduca_en)
         VALUES ($1, 'recuperar', $2, now() + interval '30 minutes')`,
        [rows[0].id, hash],
      );
    await insert('h1');
    await expect(insert('h1')).rejects.toThrow(/duplicate key/);
  });

  test('borrar una cuenta elimina sus factores, códigos y tokens (cascada)', async () => {
    const { rows } = await cuenta();
    const id = rows[0].id as string;
    await client.query(
      `INSERT INTO identity.segundo_factor (cuenta_id, secreto_cifrado) VALUES ($1, 'v1:x:y:z')`,
      [id],
    );
    await client.query(
      `INSERT INTO identity.codigo_recuperacion (cuenta_id, hash) VALUES ($1, 'h')`,
      [id],
    );
    await client.query('DELETE FROM identity.cuenta WHERE id = $1', [id]);
    const left = await client.query(
      'SELECT (SELECT count(*) FROM identity.segundo_factor WHERE cuenta_id = $1) AS f, (SELECT count(*) FROM identity.codigo_recuperacion WHERE cuenta_id = $1) AS c',
      [id],
    );
    expect(left.rows[0]).toEqual({ f: '0', c: '0' });
  });

  test('la solicitud de derechos sobrevive a la persona y exige fecha al completarse', async () => {
    const persona = await client.query<{ id: string }>(
      `INSERT INTO customers.persona (nombre_cifrado, correo_cifrado) VALUES ('v1:a:b:c', 'v1:d:e:f')
       RETURNING id`,
    );
    const ref = persona.rows[0]!.id;
    await client.query(
      `INSERT INTO customers.solicitud_derechos (persona_ref, tipo) VALUES ($1, 'eliminacion')`,
      [ref],
    );
    await client.query('DELETE FROM customers.persona WHERE id = $1', [ref]);
    const left = await client.query<{ vence: boolean }>(
      `SELECT vence_en > solicitada_en + interval '14 days' AS vence FROM customers.solicitud_derechos
       WHERE persona_ref = $1`,
      [ref],
    );
    expect(left.rows).toEqual([{ vence: true }]);
    await expect(
      client.query(
        `UPDATE customers.solicitud_derechos SET estado = 'completada' WHERE persona_ref = $1`,
        [ref],
      ),
    ).rejects.toThrow(/completada_con_fecha/);
  });

  test('el consentimiento guarda cada cambio y se borra con la persona', async () => {
    const persona = await client.query<{ id: string }>(
      `INSERT INTO customers.persona (nombre_cifrado, correo_cifrado) VALUES ('v1:a:b:c', 'v1:d:e:f')
       RETURNING id`,
    );
    const id = persona.rows[0]!.id;
    for (const estado of ['otorgado', 'retirado'])
      await client.query(
        `INSERT INTO customers.consentimiento (persona_id, finalidad, estado, version_politica)
         VALUES ($1, 'marketing', $2, '2026-11')`,
        [id, estado],
      );
    const historial = await client.query(
      'SELECT estado FROM customers.consentimiento WHERE persona_id = $1 ORDER BY cambiado_en, id',
      [id],
    );
    expect(historial.rowCount).toBe(2);
    await client.query('DELETE FROM customers.persona WHERE id = $1', [id]);
    const left = await client.query(
      'SELECT 1 FROM customers.consentimiento WHERE persona_id = $1',
      [id],
    );
    expect(left.rowCount).toBe(0);
  });
});
