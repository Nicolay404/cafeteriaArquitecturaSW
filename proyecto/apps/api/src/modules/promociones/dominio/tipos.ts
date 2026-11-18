// Tipos del dominio de Promociones y del contrato público `PromocionesApi`
// (specs/005-promociones-descuentos/contracts/promociones-api.md y data-model.md).
// Todos los importes son centavos enteros de USD (ver dinero.ts).

import type { Centavos } from './dinero.js';

// ── Promoción ──────────────────────────────────────────────────────────────────

export type TipoPromocion = 'porcentaje' | 'monto_fijo' | 'nxm' | 'combo';

export interface ProductoDeCombo {
  readonly productoId: string;
  readonly cantidad: number;
}

export type ValorPromocion =
  | { readonly tipo: 'porcentaje'; readonly puntosBasicos: number }
  | { readonly tipo: 'monto_fijo'; readonly centavos: Centavos }
  | { readonly tipo: 'nxm'; readonly lleva: number; readonly paga: number }
  | {
      readonly tipo: 'combo';
      readonly productos: readonly ProductoDeCombo[];
      readonly precioCentavos: Centavos;
    };

/** Una unidad está en el alcance si coincide con cualquiera de las tres listas (FR-003). */
export interface Alcance {
  readonly productoIds: readonly string[];
  readonly categoriaIds: readonly string[];
  readonly menuIds: readonly string[];
}

export type EstadoPromocion = 'activa' | 'pausada' | 'archivada';

export interface Cupon {
  /** Normalizado: mayúsculas, sin espacios. */
  readonly codigo: string;
  readonly limiteUsos?: number;
}

export interface Promocion {
  readonly id: string;
  readonly nombre: string;
  readonly valor: ValorPromocion;
  readonly alcance: Alcance;
  /** Ventana semiabierta [inicio, fin) en instantes UTC. */
  readonly inicio: Date;
  readonly fin: Date;
  readonly etiquetaFestividad?: string;
  readonly prioridad: number;
  readonly acumulable: boolean;
  readonly montoMinimoCentavos?: Centavos;
  readonly cupon?: Cupon;
  readonly usos: number;
  readonly estado: EstadoPromocion;
  readonly version: number;
}

// ── Contrato de cotización ─────────────────────────────────────────────────────

/** Una línea ya resuelta por quien llama con los datos públicos de Catálogo. */
export interface LineaACotizar {
  readonly productoId: string;
  readonly categoriaIds: readonly string[];
  readonly menuId: string;
  readonly cantidad: number;
  readonly precioBaseCentavos: Centavos;
}

export interface SolicitudCotizacion {
  readonly lineas: readonly LineaACotizar[];
  readonly codigoCupon?: string;
  /**
   * Obligatorio si hay `codigoCupon`: a quién se limitan los intentos fallidos (FR-012). ID de
   * cliente de Identidad; mientras Identidad no exista, la IP.
   */
  readonly sujeto?: string;
  /** Solo para simulación del administrador; si falta, el servidor usa su reloj. */
  readonly instante?: Date;
}

export interface PromocionAplicada {
  readonly promocionId: string;
  readonly nombre: string;
  readonly descuentoCentavos: Centavos;
}

export interface LineaCotizada {
  readonly productoId: string;
  readonly cantidad: number;
  readonly precioBaseCentavos: Centavos;
  readonly subtotalCentavos: Centavos;
  readonly descuentoCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly promociones: readonly PromocionAplicada[];
}

export type EstadoCupon =
  | { readonly estado: 'aplicado'; readonly promocionId: string }
  | { readonly estado: 'monto_minimo'; readonly faltanteCentavos: Centavos }
  | { readonly estado: 'agotado' | 'no_vigente' | 'no_valido' | 'sin_efecto' };

export interface Cotizacion {
  /** ISO-8601 UTC del instante del cálculo. */
  readonly instante: string;
  readonly lineas: readonly LineaCotizada[];
  readonly subtotalCentavos: Centavos;
  readonly descuentoCentavos: Centavos;
  readonly totalCentavos: Centavos;
  readonly promocionesAplicadas: readonly PromocionAplicada[];
  readonly cupon?: EstadoCupon;
}

export type ResultadoUsos =
  { readonly ok: true } | { readonly ok: false; readonly agotadas: readonly string[] };

export interface PromocionesApi {
  cotizar(solicitud: SolicitudCotizacion): Promise<Cotizacion>;
  registrarUsos(pedidoId: string, promocionIds: readonly string[]): Promise<ResultadoUsos>;
  liberarUsos(pedidoId: string): Promise<void>;
}
