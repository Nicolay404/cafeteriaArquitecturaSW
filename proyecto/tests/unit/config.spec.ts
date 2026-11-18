import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readApiConfig } from '../../apps/api/src/platform/config.js';
import { readWorkerConfig } from '../../apps/worker/src/config.js';
import { readWebConfig } from '../../apps/web/src/server/config.js';

const examplePath = fileURLToPath(new URL('../../.env.example', import.meta.url));
const example = parseEnv(readFileSync(examplePath, 'utf8'));
const input = (overrides: Record<string, string | undefined> = {}) => ({
  envFile: null,
  environment: { ...example, ...overrides },
});

describe('secretos de Identidad (Spec #2)', () => {
  it.each(['PII_KEY_1', 'PII_INDEX_KEY', 'SESSION_SECRET'])(
    '%s es obligatorio y de al menos 32 caracteres',
    (name) => {
      expect(() => readApiConfig(input({ [name]: undefined }))).toThrow(name);
      expect(() => readApiConfig(input({ [name]: 'corto' }))).toThrow(name);
    },
  );

  it('los valores de prueba de .env.example solo valen en local', () => {
    expect(readApiConfig(input()).piiIndexKey).toMatch(/^solo_pruebas_locales/);
    expect(() => readApiConfig(input({ APP_ENV: 'staging' }))).toThrow('PII_KEY_1');
    const real = 'k'.repeat(40);
    const config = readApiConfig(
      input({ APP_ENV: 'staging', PII_KEY_1: real, PII_INDEX_KEY: real, SESSION_SECRET: real }),
    );
    expect(config.hibpEnabled).toBe(false);
  });

  it('HIBP_ENABLED solo acepta true o false', () => {
    expect(() => readApiConfig(input({ HIBP_ENABLED: 'si' }))).toThrow('HIBP_ENABLED');
  });
});

describe('explicit environment configuration', () => {
  it('loads all three services from the versioned example without ambient mutation', () => {
    const previous = process.env['API_PORT'];
    const options = { envFile: examplePath, environment: {} };
    expect(readApiConfig(options).port).toBe(3001);
    expect(readWorkerConfig(options).smtpPort).toBe(1025);
    expect(readWebConfig(options).port).toBe(3000);
    expect(process.env['API_PORT']).toBe(previous);
  });

  it('prioritizes process settings over an explicitly loaded dotenv file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cafeteria-config-'));
    const filename = join(directory, '.env');
    try {
      writeFileSync(filename, readFileSync(examplePath));
      expect(readWebConfig({ envFile: filename, environment: { WEB_PORT: '3100' } }).port).toBe(
        3100,
      );
    } finally {
      unlinkSync(filename);
      rmdirSync(directory);
    }
  });

  it('identifies missing values without including supplied secrets', () => {
    expect(() => readApiConfig(input({ DATABASE_URL: undefined }))).toThrow('DATABASE_URL');
    expect(() => readApiConfig(input({ DATABASE_URL: 'SECRET_SENTINEL' }))).toThrow('DATABASE_URL');
    try {
      readApiConfig(input({ DATABASE_URL: 'SECRET_SENTINEL' }));
    } catch (error) {
      expect(String(error)).not.toContain('SECRET_SENTINEL');
    }
  });

  it.each(['', '-1', '65536', '3.14', 'not-a-port'])('rejects invalid port %s', (port) => {
    expect(() => readApiConfig(input({ API_PORT: port }))).toThrow('API_PORT');
  });

  it('rejects invalid protocol, environment, version and boolean', () => {
    expect(() => readWebConfig(input({ API_BASE_URL: 'javascript:alert(1)' }))).toThrow(
      'API_BASE_URL',
    );
    expect(() => readWebConfig(input({ API_BASE_URL: 'https://user:secret@example.com' }))).toThrow(
      'API_BASE_URL',
    );
    expect(() => readApiConfig(input({ APP_ENV: 'prod' }))).toThrow('APP_ENV');
    expect(() => readApiConfig(input({ APP_VERSION: ' ' }))).toThrow('APP_VERSION');
    expect(() => readWorkerConfig(input({ METRICS_EXPORT_ENABLED: 'yes' }))).toThrow(
      'METRICS_EXPORT_ENABLED',
    );
  });

  it('returns only web settings, without database or broker credentials', () => {
    const config = readWebConfig(input());
    expect(config).not.toHaveProperty('databaseUrl');
    expect(JSON.stringify(config)).not.toContain('solo_pruebas_locales');
  });

  it('returns nonzero from env:check and never prints the rejected value', () => {
    const cwd = fileURLToPath(new URL('../../', import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/env-check.ts'], {
      cwd,
      env: { ...process.env, ...example, DATABASE_URL: 'SECRET_SENTINEL' },
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
    expect(result.stdout + result.stderr).not.toContain('SECRET_SENTINEL');
  });

  it('env:check loads an explicit shared file for all services without ambient values', () => {
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !(key in example)),
    );
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/env-check.ts', '--env-file', '.env.example'],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: environment,
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('API, worker y web');
    expect(result.stdout + result.stderr).not.toContain('solo_pruebas_locales');
  });
});
