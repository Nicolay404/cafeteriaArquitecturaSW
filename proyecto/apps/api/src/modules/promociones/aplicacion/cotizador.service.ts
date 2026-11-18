// Caso de uso `cotizar` del contrato PromocionesApi (contracts/promociones-api.md, T009).
// Une la fuente de promociones (repositorio o caché, T008/T021) con el motor puro. El instante
// lo pone el reloj del servidor; solo la simulación del administrador (FR-013) envía uno propio.

import { calcularCotizacion, type EntradaMotor } from '../dominio/motor-precios.js';
import type { Cotizacion, Promocion, SolicitudCotizacion } from '../dominio/tipos.js';

/** Devuelve, como mínimo, las promociones activas cuya ventana no ha terminado en `instante`. */
export interface FuentePromociones {
  candidatas(instante: Date): Promise<readonly Promocion[]>;
}

export type Reloj = () => Date;

export class CotizadorPromociones {
  constructor(
    private readonly fuente: FuentePromociones,
    private readonly reloj: Reloj = () => new Date(),
  ) {}

  async cotizar(solicitud: SolicitudCotizacion): Promise<Cotizacion> {
    const instante = solicitud.instante ?? this.reloj();
    const promociones = await this.fuente.candidatas(instante);
    const entrada: EntradaMotor =
      solicitud.codigoCupon === undefined
        ? { lineas: solicitud.lineas }
        : { lineas: solicitud.lineas, codigoCupon: solicitud.codigoCupon };
    return calcularCotizacion(entrada, promociones, instante);
  }
}
