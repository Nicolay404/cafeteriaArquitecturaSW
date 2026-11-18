import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { runFlagsSet } from '../../scripts/flags-set.js';
import { runMigrate } from '../../scripts/db/migrate.js';

// T052/T053 — el cableado de los CLI `flags:set` y `db:migrate`: argumentos, autorización,
// configuración ausente y códigos de salida. La lógica de fondo ya la prueban flags.int y migrations.int.
describe('CLI contra servicios reales', () => {
  let infrastructure: Infrastructure;
  beforeAll(async () => {
    infrastructure = await startInfrastructure();
  });
  afterAll(async () => {
    await infrastructure?.stop();
  });

  const logs = () => {
    const lines: string[] = [];
    return { lines, log: (line: string) => lines.push(line) };
  };

  describe('flags:set', () => {
    const env = (overrides: Record<string, string | undefined> = {}) => ({
      APP_ENV: 'local',
      REDIS_URL: infrastructure.redisUrl,
      FEATURE_FLAGS_PREFIX: `cafeteria:cli-${randomUUID()}:flags`,
      ...overrides,
    });
    const run = async (args: string[], environment = env()) => {
      const { lines, log } = logs();
      const code = await runFlagsSet(args, () => environment, log);
      return { code, text: lines.join('\n') };
    };

    test('enciende y apaga con revisión creciente', async () => {
      const environment = env();
      const on = await run(['capacidad-tecnica-de-prueba', 'on'], environment);
      expect(on.code).toBe(0);
      expect(on.text).toMatch(/encendido \(revisión 1,/);
      const off = await run(['--', 'capacidad-tecnica-de-prueba', 'off'], environment);
      expect(off.code).toBe(0);
      expect(off.text).toMatch(/apagado \(revisión 2,/);
    });

    test('rechaza una clave no permitida', async () => {
      const result = await run(['otra', 'on']);
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/no está permitida/);
    });

    test.each([
      [[]],
      [['capacidad-tecnica-de-prueba']],
      [['capacidad-tecnica-de-prueba', 'quizas']],
    ])('un uso incorrecto (%j) explica cómo usarlo', async (args) => {
      const result = await run(args as string[]);
      expect(result.code).toBe(1);
      expect(result.text).toContain('Uso: pnpm flags:set');
    });

    test('un argumento desconocido es un error de uso', async () => {
      const result = await run(['capacidad-tecnica-de-prueba', 'on', '--inventado']);
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/inventado/);
    });

    test('se niega fuera de local sin escribir', async () => {
      const result = await run(['capacidad-tecnica-de-prueba', 'on'], env({ APP_ENV: 'staging' }));
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/no autorizada/);
    });

    test('una configuración ausente se nombra sin volcar valores', async () => {
      const result = await run(
        ['capacidad-tecnica-de-prueba', 'on'],
        env({ FEATURE_FLAGS_PREFIX: undefined }),
      );
      expect(result.code).toBe(1);
      expect(result.text).toBe('Configuración inválida: FEATURE_FLAGS_PREFIX');
    });
  });

  describe('db:migrate', () => {
    async function freshDatabase() {
      const name = `cli_${randomUUID().replaceAll('-', '')}`;
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
    const run = async (args: string[], environment: Record<string, string | undefined>) => {
      const { lines, log } = logs();
      const code = await runMigrate(args, () => environment, log);
      return { code, text: lines.join('\n') };
    };

    test('aplica la migración real y después informa que ya está aplicada', async () => {
      const environment = { APP_ENV: 'local', DATABASE_URL: await freshDatabase() };
      const first = await run([], environment);
      expect(first).toEqual({
        code: 0,
        text: 'Migraciones aplicadas: 001, 010, 011; ya aplicadas: ninguna',
      });
      const second = await run(['--'], environment);
      expect(second).toEqual({
        code: 0,
        text: 'Migraciones aplicadas: ninguna; ya aplicadas: 001, 010, 011',
      });
    });

    test('se niega fuera de local', async () => {
      const result = await run([], { APP_ENV: 'production', DATABASE_URL: await freshDatabase() });
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/no autorizadas/);
    });

    test('se niega con una base remota aunque diga local', async () => {
      const result = await run([], {
        APP_ENV: 'local',
        DATABASE_URL: 'postgresql://u:p@base.ejemplo.test:5432/x',
      });
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/no es local/);
    });

    test('una configuración ausente o inválida se nombra sin volcar valores', async () => {
      expect(await run([], { APP_ENV: 'local' })).toEqual({
        code: 1,
        text: 'Configuración inválida: DATABASE_URL',
      });
    });

    test('ya no acepta elegir la carpeta de migraciones', async () => {
      const result = await run(['--dir', '../otra'], {
        APP_ENV: 'local',
        DATABASE_URL: await freshDatabase(),
      });
      expect(result.code).toBe(1);
      expect(result.text).toMatch(/dir/);
    });
  });
});
