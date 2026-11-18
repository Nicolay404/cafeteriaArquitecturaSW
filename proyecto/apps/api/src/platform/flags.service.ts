import { createClient } from 'redis';

// FR-005 / Constitución VII: las funciones incompletas se integran detrás de un flag que se
// puede apagar en runtime, sin redeploy. Solo claves técnicas de la plataforma, nunca de negocio.
// Una clave nueva se añade aquí a propósito: lo que no figura en la lista no se puede escribir.
export const TECHNICAL_FLAGS = ['capacidad-tecnica-de-prueba'] as const;
export type TechnicalFlag = (typeof TECHNICAL_FLAGS)[number];

export interface FlagTecnico {
  key: TechnicalFlag;
  enabled: boolean;
  revision: number;
  changedAt: string;
}

export interface FlagsConfig {
  redisUrl: string;
  flagsPrefix: string;
}

export const isTechnicalFlag = (key: string): key is TechnicalFlag =>
  (TECHNICAL_FLAGS as readonly string[]).includes(key);

/** Clave del hash en Redis: `<prefijo>:<clave>` con los campos enabled, revision y changedAt. */
export const flagKey = (prefix: string, key: string) => `${prefix}:${key}`;

const TIMEOUT_MS = 1000;

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Flags no disponibles')), TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class FlagsService {
  constructor(private readonly config: FlagsConfig) {}

  /**
   * Lectura en runtime en cada llamada. Falla SEGURO: ante cualquier problema (Redis caído,
   * clave desconocida, valor ausente o corrupto) el flag está apagado.
   */
  async isEnabled(key: string): Promise<boolean> {
    if (!isTechnicalFlag(key)) return false;
    const redis = createClient({
      url: this.config.redisUrl,
      socket: { connectTimeout: 800, reconnectStrategy: false },
    });
    redis.on('error', () => {});
    try {
      await bounded(redis.connect());
      const value = await bounded(redis.hGet(flagKey(this.config.flagsPrefix, key), 'enabled'));
      return value === 'true';
    } catch {
      return false;
    } finally {
      if (redis.isOpen) redis.destroy();
    }
  }
}
