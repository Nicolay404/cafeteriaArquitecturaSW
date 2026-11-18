import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { ConfigurationError, loadEnvironment, required } from '../../packages/config/src/env.js';
import type { Environment } from '../../packages/config/src/env.js';
import { isMain, safeError } from '../local-environment.js';

// Constitución VII: las migraciones siguen expand/contract y son compatibles con la versión
// anterior (N−1). Este runner solo AVANZA: aplica archivos NNN_descripcion.sql en orden, cada
// uno en una transacción, con un bloqueo para que dos ejecuciones no se pisen y con el checksum
// de cada archivo. Una migración aplicada no se edita, no se borra ni se revierte: se corrige
// con una migración nueva (compensación). Si una falla, se deshace entera y las anteriores
// siguen aplicadas, de modo que la versión N−1 sigue atendiendo.

/** Clave del bloqueo consultivo de Postgres; constante para que todas las ejecuciones compitan por el mismo. */
export const lockKey = 7_201_100_001;

const FILE_NAME = /^(\d{3})_([a-z0-9_]+)\.sql$/;

export interface Migration {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export function loadMigrations(directory: string): Migration[] {
  const migrations = readdirSync(directory)
    .filter((file) => file.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'))
    .map((file): Migration => {
      const match = FILE_NAME.exec(file);
      if (!match)
        throw new Error(`Nombre de migración inválido: «${file}» (se espera NNN_descripcion.sql)`);
      const content = readFileSync(join(directory, file));
      return {
        version: match[1]!,
        name: match[2]!,
        sql: content.toString('utf8'),
        checksum: createHash('sha256').update(content).digest('hex'),
      };
    });
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.version))
      throw new Error(`Versión de migración duplicada: ${migration.version}`);
    seen.add(migration.version);
  }
  return migrations;
}

async function acquireLock(client: Client, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [lockKey],
    );
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) throw new Error('Hay otra migración en curso; no se aplicó nada');
    await delay(100);
  }
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(options: {
  databaseUrl: string;
  directory: string;
  lockTimeoutMs?: number;
}): Promise<MigrateResult> {
  // Se valida todo lo que no necesita la base antes de conectarse.
  const migrations = loadMigrations(options.directory);
  const client = new Client({
    connectionString: options.databaseUrl,
    connectionTimeoutMillis: 5000,
  });
  client.on('error', () => {});
  await client.connect();
  try {
    await acquireLock(client, options.lockTimeoutMs ?? 10_000);
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS platform');
      await client.query(`CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version text PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await client.query<{ version: string; checksum: string }>(
        'SELECT version, checksum FROM platform.schema_migrations ORDER BY version',
      );
      const recorded = new Map(rows.map((row) => [row.version, row.checksum]));
      const onDisk = new Map(migrations.map((migration) => [migration.version, migration]));

      for (const version of recorded.keys())
        if (!onDisk.has(version))
          throw new Error(
            `La migración ${version} ya está aplicada pero no está en el repositorio`,
          );

      const result: MigrateResult = { applied: [], alreadyApplied: [] };
      for (const migration of migrations) {
        const checksum = recorded.get(migration.version);
        if (checksum !== undefined) {
          if (checksum !== migration.checksum)
            throw new Error(
              `La migración ${migration.version} ya está aplicada y su checksum cambió: no se edita, se corrige con una migración nueva`,
            );
          result.alreadyApplied.push(migration.version);
          continue;
        }
        try {
          await client.query('BEGIN');
          await client.query(migration.sql);
          await client.query(
            'INSERT INTO platform.schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
            [migration.version, migration.name, migration.checksum],
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw new Error(
            `La migración ${migration.version} (${migration.name}) falló y se revirtió completa: ${
              error instanceof Error ? error.message : 'error desconocido'
            }`,
          );
        }
        result.applied.push(migration.version);
      }
      return result;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Solo local por ahora: staging y producción llegan con la identidad de pipeline (T055). */
export function authorizeMigration(environment: Environment) {
  if (environment['APP_ENV'] !== 'local')
    throw new Error(
      'Migraciones no autorizadas fuera de local: hace falta la identidad del pipeline (T055)',
    );
  let host: string;
  try {
    host = new URL(environment['DATABASE_URL'] ?? '').hostname;
  } catch {
    throw new ConfigurationError('DATABASE_URL');
  }
  if (!LOCAL_HOSTS.includes(host))
    throw new Error('Migraciones no autorizadas: la base no es local');
}

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument) => argument !== '--'),
    options: {
      'env-file': { type: 'string', default: '.env' },
      dir: { type: 'string', default: 'infra/migrations' },
    },
  });
  const environment = loadEnvironment({ envFile: values['env-file']! });
  authorizeMigration(environment);
  const result = await migrate({
    databaseUrl: required(environment, 'DATABASE_URL'),
    directory: resolve(values.dir!),
  });
  console.log(
    `Migraciones aplicadas: ${result.applied.join(', ') || 'ninguna'}; ya aplicadas: ${result.alreadyApplied.join(', ') || 'ninguna'}`,
  );
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error && !(error instanceof ConfigurationError)
        ? error.message
        : safeError(error),
    );
    process.exitCode = 1;
  });
}
