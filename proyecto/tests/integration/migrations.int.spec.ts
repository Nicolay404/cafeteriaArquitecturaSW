import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { migrate } from '../../scripts/db/migrate.js';

// T051/T053 — Constitución VII: migraciones expand/contract compatibles con la versión anterior
// (N−1), con checksum, bloqueo, fallo sin efectos parciales y compensación sin perder filas.
// Solo la tabla técnica sintética platform.probe; sin tablas ni datos de negocio.
const fixtures = fileURLToPath(new URL('../fixtures/migrations/', import.meta.url));
const real = fileURLToPath(new URL('../../infra/migrations/', import.meta.url));

describe('T051 — migraciones con Postgres real', () => {
  let infrastructure: Infrastructure;
  const directories: string[] = [];

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
  });
  afterAll(async () => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
    await infrastructure?.stop();
  });

  /** Base de datos nueva por prueba para que ninguna dependa del estado de otra. */
  async function freshDatabase() {
    const name = `t051_${randomUUID().replaceAll('-', '')}`;
    const admin = new Client({ connectionString: infrastructure.databaseUrl });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${name}`);
    } finally {
      await admin.end();
    }
    const url = new URL(infrastructure.databaseUrl);
    url.pathname = `/${name}`;
    return url.toString();
  }

  /** Carpeta de migraciones con la 001 real más los fixtures indicados. */
  function directory(...files: Array<[from: string, as: string]>) {
    const path = mkdtempSync(join(tmpdir(), 'cafeteria-migrations-'));
    directories.push(path);
    copyFileSync(join(real, '001_platform_probe.sql'), join(path, '001_platform_probe.sql'));
    for (const [from, as] of files) copyFileSync(join(fixtures, from), join(path, as));
    return path;
  }

  async function query<T extends Record<string, unknown>>(
    url: string,
    sql: string,
    values: unknown[] = [],
  ) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      return (await client.query(sql, values)).rows as T[];
    } finally {
      await client.end();
    }
  }

  // La versión N−1 de la aplicación solo conoce la columna note.
  const insertOld = (url: string, note: string) =>
    query(url, 'INSERT INTO platform.probe (note) VALUES ($1)', [note]);

  test('aplica la migración técnica real, registra su checksum y es idempotente', async () => {
    const url = await freshDatabase();
    const path = directory();
    const first = await migrate({ databaseUrl: url, directory: path });
    expect(first.applied).toEqual(['001']);

    const [row] = await query<{ version: string; checksum: string }>(
      url,
      'SELECT version, checksum FROM platform.schema_migrations',
    );
    const expected = createHash('sha256')
      .update(readFileSync(join(real, '001_platform_probe.sql')))
      .digest('hex');
    expect(row).toEqual({ version: '001', checksum: expected });
    expect(await query(url, 'SELECT count(*)::int AS n FROM platform.probe')).toEqual([{ n: 0 }]);

    const second = await migrate({ databaseUrl: url, directory: path });
    expect(second).toEqual({ applied: [], alreadyApplied: ['001'] });
  });

  test('una migración ya aplicada que se edita se rechaza por su checksum', async () => {
    const url = await freshDatabase();
    const path = directory();
    await migrate({ databaseUrl: url, directory: path });
    writeFileSync(join(path, '001_platform_probe.sql'), '-- editada\nSELECT 1;\n');
    await expect(migrate({ databaseUrl: url, directory: path })).rejects.toThrow(/checksum/i);
    expect(await query(url, 'SELECT count(*)::int AS n FROM platform.schema_migrations')).toEqual([
      { n: 1 },
    ]);
  });

  test('una migración aplicada que desaparece del repositorio se rechaza', async () => {
    const url = await freshDatabase();
    await migrate({ databaseUrl: url, directory: directory() });
    const empty = mkdtempSync(join(tmpdir(), 'cafeteria-migrations-'));
    directories.push(empty);
    await expect(migrate({ databaseUrl: url, directory: empty })).rejects.toThrow(/001/);
  });

  test('un nombre de archivo que no sigue el patrón se rechaza antes de tocar la base', async () => {
    const url = await freshDatabase();
    const path = directory();
    writeFileSync(join(path, 'sin-numero.sql'), 'SELECT 1;');
    await expect(migrate({ databaseUrl: url, directory: path })).rejects.toThrow(/nombre/i);
    await expect(query(url, 'SELECT 1 FROM platform.schema_migrations')).rejects.toThrow();
  });

  test('con el bloqueo ocupado falla sin aplicar nada, y dos ejecuciones simultáneas no duplican', async () => {
    const url = await freshDatabase();
    const path = directory();

    const holder = new Client({ connectionString: url });
    await holder.connect();
    try {
      const { lockKey } = await import('../../scripts/db/migrate.js');
      await holder.query('SELECT pg_advisory_lock($1)', [lockKey]);
      await expect(
        migrate({ databaseUrl: url, directory: path, lockTimeoutMs: 600 }),
      ).rejects.toThrow(/en curso/i);
      await expect(query(url, 'SELECT 1 FROM platform.probe')).rejects.toThrow();
    } finally {
      await holder.end();
    }

    const results = await Promise.all([
      migrate({ databaseUrl: url, directory: path, lockTimeoutMs: 15_000 }),
      migrate({ databaseUrl: url, directory: path, lockTimeoutMs: 15_000 }),
    ]);
    expect(results.flatMap((item) => item.applied)).toEqual(['001']);
    expect(await query(url, 'SELECT count(*)::int AS n FROM platform.schema_migrations')).toEqual([
      { n: 1 },
    ]);
  });

  test('expandir es compatible con la versión anterior (N−1) y con la nueva (N)', async () => {
    const url = await freshDatabase();
    await migrate({ databaseUrl: url, directory: directory() });
    await insertOld(url, 'antes de expandir');

    await migrate({
      databaseUrl: url,
      directory: directory(['002_expand_add_detail.sql', '002_expand_add_detail.sql']),
    });

    // N−1 sigue escribiendo sin conocer la columna nueva; N la usa.
    await insertOld(url, 'N−1 después de expandir');
    await query(url, 'INSERT INTO platform.probe (note, detail) VALUES ($1, $2)', [
      'N',
      'con detalle',
    ]);
    const rows = await query<{ note: string; detail: string | null }>(
      url,
      'SELECT note, detail FROM platform.probe ORDER BY id',
    );
    expect(rows).toEqual([
      { note: 'antes de expandir', detail: null },
      { note: 'N−1 después de expandir', detail: null },
      { note: 'N', detail: 'con detalle' },
    ]);
  });

  test('si una migración falla, no queda nada a medias y N−1 sigue atendiendo', async () => {
    const url = await freshDatabase();
    await migrate({ databaseUrl: url, directory: directory() });
    await insertOld(url, 'fila previa');

    await expect(
      migrate({
        databaseUrl: url,
        directory: directory(['002_fail_midway.sql', '002_fail_midway.sql']),
      }),
    ).rejects.toThrow(/002/);

    // La primera sentencia (ADD COLUMN) se deshizo junto con la fallida.
    const columns = await query<{ column_name: string }>(
      url,
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'platform' AND table_name = 'probe'",
    );
    expect(columns.map((item) => item.column_name).sort()).toEqual(['created_at', 'id', 'note']);
    expect(await query(url, 'SELECT version FROM platform.schema_migrations')).toEqual([
      { version: '001' },
    ]);
    await insertOld(url, 'N−1 tras el fallo');
    expect(await query(url, 'SELECT count(*)::int AS n FROM platform.probe')).toEqual([{ n: 2 }]);
  });

  test('contraer rompe N−1 y se compensa con una migración nueva que conserva las filas', async () => {
    const url = await freshDatabase();
    const expand: [string, string] = ['002_expand_add_detail.sql', '002_expand_add_detail.sql'];
    const contract: [string, string] = [
      '003_contract_detail_not_null.sql',
      '003_contract_detail_not_null.sql',
    ];
    const compensate: [string, string] = [
      '004_compensate_drop_not_null.sql',
      '004_compensate_drop_not_null.sql',
    ];
    await migrate({ databaseUrl: url, directory: directory(expand) });
    await insertOld(url, 'fila 1');
    await insertOld(url, 'fila 2');

    // Contraer mientras corre N−1 es exactamente lo que el patrón prohíbe: aquí se demuestra por qué.
    await migrate({ databaseUrl: url, directory: directory(expand, contract) });
    await expect(insertOld(url, 'N−1 tras contraer')).rejects.toThrow();
    const before = await query<{ note: string; detail: string }>(
      url,
      'SELECT note, detail FROM platform.probe ORDER BY id',
    );
    expect(before).toEqual([
      { note: 'fila 1', detail: 'sin detalle' },
      { note: 'fila 2', detail: 'sin detalle' },
    ]);

    // Compensación: una migración NUEVA; la 003 no se borra ni se edita.
    const result = await migrate({
      databaseUrl: url,
      directory: directory(expand, contract, compensate),
    });
    expect(result.applied).toEqual(['004']);
    await insertOld(url, 'N−1 tras compensar');
    expect(await query(url, 'SELECT note FROM platform.probe ORDER BY id')).toEqual([
      { note: 'fila 1' },
      { note: 'fila 2' },
      { note: 'N−1 tras compensar' },
    ]);
    expect(
      await query(url, 'SELECT version FROM platform.schema_migrations ORDER BY version'),
    ).toEqual([{ version: '001' }, { version: '002' }, { version: '003' }, { version: '004' }]);
  });
});
