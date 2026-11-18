import { createClient } from 'redis';

// FR-005 / research D-08: límite de intentos con ventana deslizante en Redis. El estado vive en
// Redis (no en memoria) para que N instancias de la API compartan la misma cuenta. Cada operación
// es un script Lua atómico que usa el reloj de Redis, así dos instancias nunca discrepan.
// Si Redis no responde se lanza LimiterUnavailableError: quien llama debe FALLAR CERRADO (503),
// nunca dejar pasar intentos sin límite.

export interface RateRule {
  /** Intentos permitidos dentro de la ventana. */
  limit: number;
  windowSeconds: number;
}

export interface RateResult {
  allowed: boolean;
  /** Intentos que quedan antes del bloqueo. */
  remaining: number;
  /** Segundos hasta poder intentarlo de nuevo; 0 si está permitido. */
  retryAfterSeconds: number;
}

export class LimiterUnavailableError extends Error {
  constructor() {
    super('El limitador de intentos no está disponible');
    this.name = 'LimiterUnavailableError';
  }
}

// ARGV: ventana en ms, límite, 1 = anotar / 0 = solo consultar, sufijo único del miembro.
const SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry = math.ceil((tonumber(oldest[2]) + window - now) / 1000)
  if retry < 1 then retry = 1 end
  return {0, 0, retry}
end
if ARGV[3] == '1' then
  redis.call('ZADD', KEYS[1], now, now .. ':' .. ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window + 1000)
  count = count + 1
end
return {1, limit - count, 0}
`;

const TIMEOUT_MS = 1000;

export interface RateLimiterConfig {
  redisUrl: string;
  /** Prefijo de las claves, p. ej. `cafeteria:local:limite`. */
  prefix: string;
}

const open = (url: string) =>
  createClient({
    url,
    socket: { connectTimeout: 800, reconnectStrategy: (retries) => Math.min(retries * 100, 500) },
  });
type Client = ReturnType<typeof open>;

export class RateLimiter {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;

  constructor(private readonly config: RateLimiterConfig) {}

  /** Anota un intento y dice si está permitido. Un intento bloqueado NO se anota. */
  record(key: string, rule: RateRule): Promise<RateResult> {
    return this.run(key, rule, true);
  }

  /** Consulta el estado sin anotar nada (p. ej. antes de comprobar una contraseña). */
  status(key: string, rule: RateRule): Promise<RateResult> {
    return this.run(key, rule, false);
  }

  async reset(key: string): Promise<void> {
    this.assertKey(key);
    await this.guard((client) => client.del(this.redisKey(key)));
  }

  async exists(key: string): Promise<boolean> {
    this.assertKey(key);
    return (await this.guard((client) => client.exists(this.redisKey(key)))) === 1;
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    client?.destroy();
  }

  private redisKey(key: string) {
    return `${this.config.prefix}:${key}`;
  }

  private assertKey(key: string) {
    if (!key) throw new Error('La clave del límite no puede estar vacía');
  }

  private async run(key: string, rule: RateRule, record: boolean): Promise<RateResult> {
    this.assertKey(key);
    if (
      !Number.isInteger(rule.limit) ||
      rule.limit < 1 ||
      !Number.isInteger(rule.windowSeconds) ||
      rule.windowSeconds < 1
    )
      throw new Error('Regla de límite no válida: límite y ventana deben ser enteros positivos');
    const reply = (await this.guard((client) =>
      client.eval(SCRIPT, {
        keys: [this.redisKey(key)],
        arguments: [
          String(rule.windowSeconds * 1000),
          String(rule.limit),
          record ? '1' : '0',
          Math.random().toString(36).slice(2),
        ],
      }),
    )) as [number, number, number];
    return { allowed: reply[0] === 1, remaining: reply[1], retryAfterSeconds: reply[2] };
  }

  private async connect(): Promise<Client> {
    if (this.client?.isReady) return this.client;
    this.connecting ??= (async () => {
      const client = open(this.config.redisUrl);
      client.on('error', () => {});
      await client.connect();
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } catch (error) {
      this.connecting = undefined;
      throw error;
    }
  }

  private async guard<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.connect().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LimiterUnavailableError()), TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Cualquier fallo (conexión, tiempo, script) se trata igual: no hay límite fiable.
      throw new LimiterUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
