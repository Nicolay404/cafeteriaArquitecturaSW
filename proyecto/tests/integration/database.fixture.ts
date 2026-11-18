import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { migrate } from '../../scripts/db/migrate.js';
import type { Infrastructure } from './infrastructure.fixture.js';

const directory = fileURLToPath(new URL('../../infra/migrations/', import.meta.url));

/** Base de datos nueva con todas las migraciones reales aplicadas, aislada por prueba. */
export async function freshMigratedDatabase(infrastructure: Infrastructure, label = 'it') {
  const name = `${label}_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: infrastructure.databaseUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = new URL(infrastructure.databaseUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  await migrate({ databaseUrl, directory });
  return { databaseUrl, pool: new Pool({ connectionString: databaseUrl, max: 10 }) };
}

/** Inserta una cuenta mínima y devuelve su id (los índices de correo son sintéticos). */
export async function insertAccount(
  pool: Pool,
  overrides: { rol?: string; estado?: string; confirmada?: boolean } = {},
) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO identity.cuenta (persona_id, indice_correo, rol, estado, correo_confirmado_en)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      randomUUID(),
      randomUUID(),
      overrides.rol ?? 'cliente',
      overrides.estado ?? 'pendiente',
      overrides.confirmada ? new Date() : null,
    ],
  );
  return rows[0]!.id;
}
