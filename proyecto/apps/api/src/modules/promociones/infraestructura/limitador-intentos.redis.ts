// Límite de intentos fallidos de cupón en Redis (T019, FR-012, research.md R6).
// Ventana deslizante con un sorted set por sujeto: cada fallo es un miembro con su instante
// como puntuación; los anteriores a la ventana se purgan y la clave caduca sola.
// La clave lleva un hash del sujeto, no el ID de cliente ni la IP en claro (LOPDP, minimización).

import { createHash, randomUUID } from 'node:crypto';
import type { createClient } from 'redis';
import type { LimitadorIntentos } from '../aplicacion/cotizador.service.js';

type ClienteRedis = ReturnType<typeof createClient>;

export interface ConfigLimitador {
  /** Prefijo de las claves, p. ej. `cafeteria:promociones`. */
  readonly prefijo: string;
  readonly maxFallos: number;
  readonly ventanaMs: number;
  readonly ahora?: () => number;
}

/** Propuesta de research.md R6, pendiente de confirmar con el equipo: 10 fallos cada 15 minutos. */
export const LIMITE_CUPONES = { maxFallos: 10, ventanaMs: 15 * 60 * 1000 } as const;

export class LimitadorIntentosRedis implements LimitadorIntentos {
  private readonly ahora: () => number;

  constructor(
    private readonly redis: ClienteRedis,
    private readonly config: ConfigLimitador,
  ) {
    this.ahora = config.ahora ?? Date.now;
  }

  clave(sujeto: string): string {
    const huella = createHash('sha256').update(sujeto).digest('hex');
    return `${this.config.prefijo}:cupones:fallos:${huella}`;
  }

  async estaBloqueado(sujeto: string): Promise<boolean> {
    const clave = this.clave(sujeto);
    await this.redis.zRemRangeByScore(clave, '-inf', this.ahora() - this.config.ventanaMs);
    return (await this.redis.zCard(clave)) >= this.config.maxFallos;
  }

  async registrarFallo(sujeto: string): Promise<void> {
    const clave = this.clave(sujeto);
    const ahora = this.ahora();
    await this.redis
      .multi()
      .zRemRangeByScore(clave, '-inf', ahora - this.config.ventanaMs)
      .zAdd(clave, { score: ahora, value: `${String(ahora)}:${randomUUID()}` })
      .pExpire(clave, this.config.ventanaMs)
      .exec();
  }
}
