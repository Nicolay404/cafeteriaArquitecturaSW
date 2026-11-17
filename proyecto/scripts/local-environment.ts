import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadEnvironment, ConfigurationError } from '../packages/config/src/env.js';
import type { Environment } from '../packages/config/src/env.js';

export function cliEnvironment() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((argument) => argument !== '--'),
    options: { 'env-file': { type: 'string', default: '.env' } },
  });
  return loadEnvironment({ envFile: values['env-file']! });
}

export function requireLocal(environment: Environment) {
  if (environment['APP_ENV'] !== 'local') throw new ConfigurationError('APP_ENV');
  for (const key of ['DATABASE_URL', 'REDIS_URL', 'RABBITMQ_URL', 'API_BASE_URL', 'WEB_ORIGIN']) {
    let host: string;
    try {
      host = new URL(environment[key] ?? '').hostname;
    } catch {
      throw new ConfigurationError(key);
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new ConfigurationError(key);
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(environment['SMTP_HOST'] ?? ''))
    throw new ConfigurationError('SMTP_HOST');
}

export const isMain = (url: string) =>
  Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === url);
export const safeError = (error: unknown) =>
  error instanceof ConfigurationError ? error.message : 'No se pudo completar el comando local';
