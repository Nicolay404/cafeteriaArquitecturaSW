// Caché Redis de promociones vigentes (T021, research.md R8). Envuelve cualquier
// FuentePromociones (el repositorio de T008) y la comparten todas las instancias de la API.
//
// - Guarda las candidatas de un instante t0, es decir, las activas con fin > t0. Para t ≥ t0 es
//   un superconjunto válido, porque el motor vuelve a comprobar la vigencia. Para t < t0
//   (simulación en el pasado) se consulta la fuente.
// - Invalidar sube un número de versión que forma parte de la clave. Una lectura lenta que
//   escriba después de la invalidación lo hace en una clave vieja que ya nadie lee.
// - Falla segura: si Redis no responde, se lee la fuente; el precio nunca depende de la caché.
//   Si la invalidación falla, el cambio tarda como mucho el TTL (60 s) en verse.

import type { createClient } from 'redis';
import type { FuentePromociones } from '../aplicacion/cotizador.service.js';
import type { Promocion } from '../dominio/tipos.js';

type ClienteRedis = ReturnType<typeof createClient>;

export interface ConfigCache {
  readonly prefijo: string;
  readonly ttlMs?: number;
}

interface Entrada {
  readonly instante: string;
  readonly promociones: readonly Promocion[];
}

const TTL_POR_DEFECTO_MS = 60_000;

function revivir(texto: string): Entrada | undefined {
  try {
    const crudo = JSON.parse(texto) as Entrada;
    return {
      instante: crudo.instante,
      promociones: crudo.promociones.map((p) => ({
        ...p,
        inicio: new Date(p.inicio),
        fin: new Date(p.fin),
      })),
    };
  } catch {
    return undefined;
  }
}

export class CacheVigentes implements FuentePromociones {
  private readonly ttlMs: number;

  constructor(
    private readonly fuente: FuentePromociones,
    private readonly redis: ClienteRedis,
    private readonly config: ConfigCache,
  ) {
    this.ttlMs = config.ttlMs ?? TTL_POR_DEFECTO_MS;
  }

  private get claveVersion(): string {
    return `${this.config.prefijo}:vigentes:version`;
  }

  private claveDatos(version: string): string {
    return `${this.config.prefijo}:vigentes:v${version}`;
  }

  async candidatas(instante: Date): Promise<readonly Promocion[]> {
    let version: string;
    try {
      version = (await this.redis.get(this.claveVersion)) ?? '0';
      const texto = await this.redis.get(this.claveDatos(version));
      const entrada = texto === null ? undefined : revivir(texto);
      if (entrada && instante.getTime() >= Date.parse(entrada.instante)) return entrada.promociones;
    } catch {
      return this.fuente.candidatas(instante);
    }

    const promociones = await this.fuente.candidatas(instante);
    const entrada: Entrada = { instante: instante.toISOString(), promociones };
    try {
      await this.redis.set(this.claveDatos(version), JSON.stringify(entrada), { PX: this.ttlMs });
    } catch {
      // Sin caché esta vez; la próxima lectura lo reintenta.
    }
    return promociones;
  }

  /** Llamar tras crear, editar, pausar, reanudar o archivar una promoción. */
  async invalidar(): Promise<void> {
    try {
      await this.redis.incr(this.claveVersion);
    } catch {
      // El TTL acota el tiempo con datos viejos (R8).
    }
  }
}
