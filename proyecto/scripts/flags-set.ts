import { createClient } from 'redis';
import { parseArgs } from 'node:util';
import { ConfigurationError, loadEnvironment, required } from '../packages/config/src/env.js';
import type { Environment } from '../packages/config/src/env.js';
import {
  TECHNICAL_FLAGS,
  flagKey,
  isTechnicalFlag,
} from '../apps/api/src/platform/flags.service.js';
import type { FlagTecnico } from '../apps/api/src/platform/flags.service.js';
import { isMain, safeError } from './local-environment.js';

// FR-005: único camino de ESCRITURA de flags. La API solo los lee y no expone ninguna ruta
// de escritura. Hoy solo se permite desde un entorno local; la identidad de pipeline para
// staging y producción llega con T055 y, mientras tanto, se rechaza.
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export function authorizeFlagWrite(environment: Environment) {
  // «staging» solo existe como ensayo local (alcance-local.md): el Redis debe ser de loopback, como
  // en local. Producción sigue prohibida: exigiría la identidad de un pipeline que aún no existe.
  if (!['local', 'staging'].includes(environment['APP_ENV'] ?? ''))
    throw new Error(
      'Escritura de flags no autorizada: fuera de local o del staging local hace falta la identidad del pipeline',
    );
  let host: string;
  try {
    host = new URL(environment['REDIS_URL'] ?? '').hostname;
  } catch {
    throw new ConfigurationError('REDIS_URL');
  }
  if (!LOCAL_HOSTS.includes(host))
    throw new Error('Escritura de flags no autorizada: el Redis no es local');
}

const TIMEOUT_MS = 1500;

const NEXT_REVISION = `
local current = tonumber(redis.call('HGET', KEYS[1], 'revision'))
if current == nil or current < 0 then current = 0 end
local revision = math.floor(current) + 1
redis.call('HSET', KEYS[1], 'enabled', ARGV[1], 'revision', revision, 'changedAt', ARGV[2])
return revision
`;

export async function setFlag(options: {
  redisUrl: string;
  prefix: string;
  key: string;
  enabled: boolean;
}): Promise<FlagTecnico> {
  if (!isTechnicalFlag(options.key))
    throw new Error(
      `La clave «${options.key}» no está permitida; claves técnicas: ${TECHNICAL_FLAGS.join(', ')}`,
    );
  if (typeof options.enabled !== 'boolean') throw new Error('El valor debe ser booleano');

  const redis = createClient({
    url: options.redisUrl,
    socket: { connectTimeout: TIMEOUT_MS, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  const changedAt = new Date().toISOString();
  try {
    await redis.connect();
    // Atómico: la revisión sube y el valor cambia juntos. Una revisión corrupta cuenta como 0,
    // de modo que un valor dañado en Redis no impide volver a escribir el flag.
    const revision = await redis.eval(NEXT_REVISION, {
      keys: [flagKey(options.prefix, options.key)],
      arguments: [String(options.enabled), changedAt],
    });
    return { key: options.key, enabled: options.enabled, revision: Number(revision), changedAt };
  } finally {
    if (redis.isOpen) redis.destroy();
  }
}

// Por forma y no con instanceof: los errores de node:util pueden venir de otro contexto de ejecución.
const describe = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'message' in error &&
  typeof error.message === 'string' &&
  error.message !== ''
    ? error.message
    : safeError(error);

const STATES: Record<string, boolean> = { on: true, true: true, off: false, false: false };

/** Cambia un flag desde la línea de comandos. Devuelve el código de salida. */
export async function runFlagsSet(
  args: string[],
  load: (envFile: string) => Environment,
  log: (line: string) => void,
): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: args.filter((argument) => argument !== '--'),
      allowPositionals: true,
      options: { 'env-file': { type: 'string', default: '.env' } },
    });
    const [key, value] = positionals;
    if (!key || value === undefined || !(value in STATES))
      throw new Error('Uso: pnpm flags:set <clave> <on|off> [--env-file archivo]');
    const environment = load(values['env-file']!);
    authorizeFlagWrite(environment);
    const flag = await setFlag({
      redisUrl: required(environment, 'REDIS_URL'),
      prefix: required(environment, 'FEATURE_FLAGS_PREFIX'),
      key,
      enabled: STATES[value]!,
    });
    log(
      `${flag.key}: ${flag.enabled ? 'encendido' : 'apagado'} (revisión ${flag.revision}, ${flag.changedAt})`,
    );
    return 0;
  } catch (error) {
    log(describe(error));
    return 1;
  }
}

if (isMain(import.meta.url)) {
  void runFlagsSet(
    process.argv.slice(2),
    (envFile) => loadEnvironment({ envFile }),
    (line) => console.log(line),
  ).then((code) => {
    process.exitCode = code;
  });
}
