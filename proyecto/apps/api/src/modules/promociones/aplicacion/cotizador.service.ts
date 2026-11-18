// Caso de uso `cotizar` del contrato PromocionesApi (contracts/promociones-api.md, T009, T019).
// Une la fuente de promociones (repositorio o caché, T008/T021) con el motor puro. El instante
// lo pone el reloj del servidor; solo la simulación del administrador (FR-013) envía uno propio.
// Los códigos de cupón no válidos cuentan como intentos fallidos por sujeto (FR-012).

import {
  SolicitudInvalida,
  calcularCotizacion,
  type EntradaMotor,
} from '../dominio/motor-precios.js';
import type { Cotizacion, Promocion, SolicitudCotizacion } from '../dominio/tipos.js';

/** Devuelve, como mínimo, las promociones activas cuya ventana no ha terminado en `instante`. */
export interface FuentePromociones {
  candidatas(instante: Date): Promise<readonly Promocion[]>;
}

/** Cuenta los intentos fallidos de cupón por sujeto en una ventana deslizante. */
export interface LimitadorIntentos {
  estaBloqueado(sujeto: string): Promise<boolean>;
  registrarFallo(sujeto: string): Promise<void>;
}

export type Reloj = () => Date;

export interface OpcionesCotizador {
  readonly limitador: LimitadorIntentos;
  readonly reloj?: Reloj;
}

export class DemasiadosIntentosCupon extends Error {
  constructor() {
    super(
      'Demasiados intentos con códigos de cupón no válidos. Revise el código y vuelva a intentarlo en 15 minutos.',
    );
    this.name = 'DemasiadosIntentosCupon';
  }
}

export class CotizadorPromociones {
  private readonly limitador: LimitadorIntentos;
  private readonly reloj: Reloj;

  constructor(
    private readonly fuente: FuentePromociones,
    opciones: OpcionesCotizador,
  ) {
    this.limitador = opciones.limitador;
    this.reloj = opciones.reloj ?? (() => new Date());
  }

  async cotizar(solicitud: SolicitudCotizacion): Promise<Cotizacion> {
    const sujeto = solicitud.codigoCupon === undefined ? undefined : this.sujeto(solicitud);
    if (sujeto !== undefined && (await this.consultar(() => this.limitador.estaBloqueado(sujeto))))
      throw new DemasiadosIntentosCupon();

    const instante = solicitud.instante ?? this.reloj();
    const promociones = await this.fuente.candidatas(instante);
    const entrada: EntradaMotor =
      solicitud.codigoCupon === undefined
        ? { lineas: solicitud.lineas }
        : { lineas: solicitud.lineas, codigoCupon: solicitud.codigoCupon };
    const cotizacion = calcularCotizacion(entrada, promociones, instante);

    if (sujeto !== undefined && cotizacion.cupon?.estado === 'no_valido')
      await this.consultar(() => this.limitador.registrarFallo(sujeto));
    return cotizacion;
  }

  private sujeto(solicitud: SolicitudCotizacion): string {
    const sujeto = solicitud.sujeto?.trim() ?? '';
    if (sujeto === '')
      throw new SolicitudInvalida('Para usar un cupón hace falta identificar al cliente (sujeto).');
    return sujeto;
  }

  /**
   * Falla abierta (R6): si el almacén de intentos no responde, se cotiza igual. Los cupones son
   * códigos de marketing, no secretos, y el precio debe seguir disponible para el carrito.
   */
  private async consultar<T>(operacion: () => Promise<T>): Promise<T | undefined> {
    try {
      return await operacion();
    } catch {
      return undefined;
    }
  }
}
