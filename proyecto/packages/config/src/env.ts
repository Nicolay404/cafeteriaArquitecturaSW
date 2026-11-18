import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseEnv } from 'node:util';

export type Environment = Readonly<Record<string, string | undefined>>;
export interface ConfigInput {
  environment?: Environment;
  envFile?: string | null;
}

export class ConfigurationError extends Error {
  constructor(variable: string) {
    super(`Configuración inválida: ${variable}`);
    this.name = 'ConfigurationError';
  }
}

export function loadEnvironment(input: ConfigInput = {}): Environment {
  const filename =
    input.envFile === undefined
      ? resolve(dirname(fileURLToPath(import.meta.url)), '../../..', '.env')
      : input.envFile;
  let fileValues: Environment = {};
  if (filename !== null) {
    try {
      fileValues = parseEnv(readFileSync(filename, 'utf8'));
    } catch (error) {
      const missingDefault =
        input.envFile === undefined &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT';
      if (!missingDefault) throw new ConfigurationError('ENV_FILE');
    }
  }
  return { ...fileValues, ...(input.environment ?? process.env) };
}

export function required(environment: Environment, variable: string): string {
  const value = environment[variable]?.trim();
  if (!value) throw new ConfigurationError(variable);
  return value;
}

export function choice<T extends readonly string[]>(
  environment: Environment,
  variable: string,
  values: T,
): T[number] {
  const value = required(environment, variable);
  if (!values.includes(value)) throw new ConfigurationError(variable);
  return value as T[number];
}

export function port(environment: Environment, variable: string): number {
  const value = required(environment, variable);
  const numeric = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new ConfigurationError(variable);
  }
  return numeric;
}

export function url(
  environment: Environment,
  variable: string,
  protocols: readonly string[],
  forbidCredentials = false,
): string {
  const value = required(environment, variable);
  try {
    const parsed = new URL(value);
    if (
      !protocols.includes(parsed.protocol) ||
      !parsed.hostname ||
      (forbidCredentials && (parsed.username || parsed.password))
    ) {
      throw new ConfigurationError(variable);
    }
  } catch {
    throw new ConfigurationError(variable);
  }
  return value;
}

/**
 * Secreto de aplicación: al menos 32 caracteres. Las claves concretas se derivan con HKDF, así que
 * no hace falta un formato binario. Fuera de local se rechazan los valores de prueba de .env.example.
 */
export function secret(environment: Environment, variable: string, appEnv: string): string {
  const value = required(environment, variable);
  if (value.length < 32) throw new ConfigurationError(variable);
  if (appEnv !== 'local' && value.startsWith('solo_pruebas_locales'))
    throw new ConfigurationError(variable);
  return value;
}

export function base(environment: Environment) {
  return {
    nodeEnv: choice(environment, 'NODE_ENV', ['development', 'test', 'production'] as const),
    appEnv: choice(environment, 'APP_ENV', ['local', 'preview', 'staging', 'production'] as const),
    version: required(environment, 'APP_VERSION'),
  };
}
