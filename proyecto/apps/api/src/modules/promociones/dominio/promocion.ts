// Validación de promociones y transiciones de estado (FR-001, FR-002, FR-003, FR-006, FR-007,
// US1.4; reglas en data-model.md). Devuelve TODOS los errores a la vez, por campo y con un
// mensaje que dice cómo corregirlo (constitución I: errores que indican cómo corregir).
// La unicidad del código de cupón la garantiza la base de datos, no esta función.

import type { Alcance, Cupon, EstadoPromocion, Promocion, ValorPromocion } from './tipos.js';

export interface BorradorPromocion {
  readonly nombre: string;
  readonly valor: ValorPromocion;
  readonly alcance: Alcance;
  readonly inicio: Date;
  readonly fin: Date;
  readonly etiquetaFestividad?: string;
  readonly prioridad?: number;
  readonly acumulable?: boolean;
  readonly montoMinimoCentavos?: number;
  readonly cupon?: Cupon;
}

/** Datos validados de una promoción, sin los campos que asigna el servidor. */
export type DatosPromocion = Omit<Promocion, 'id' | 'usos' | 'estado' | 'version'>;

export interface ErrorCampo {
  readonly campo: string;
  readonly mensaje: string;
}

export type ResultadoValidacion =
  | { readonly ok: true; readonly valor: DatosPromocion }
  | { readonly ok: false; readonly errores: readonly ErrorCampo[] };

const PRIORIDAD_MAXIMA = 1000;
const CODIGO_CUPON = /^[A-Z0-9-]{4,32}$/;

const esEntero = (n: number, minimo: number, maximo = Number.MAX_SAFE_INTEGER): boolean =>
  Number.isSafeInteger(n) && n >= minimo && n <= maximo;

const fechaValida = (fecha: Date): boolean => !Number.isNaN(fecha.getTime());

function erroresDelValor(valor: ValorPromocion): string | undefined {
  switch (valor.tipo) {
    case 'porcentaje':
      return esEntero(valor.puntosBasicos, 1, 10_000)
        ? undefined
        : 'El porcentaje debe estar entre 0,01 % y 100 % (1 a 10000 puntos básicos).';
    case 'monto_fijo':
      return esEntero(valor.centavos, 1)
        ? undefined
        : 'El monto fijo debe ser un número entero de centavos mayor que 0.';
    case 'nxm':
      return esEntero(valor.lleva, 2) && esEntero(valor.paga, 1, valor.lleva - 1)
        ? undefined
        : 'En una promoción N×M, «lleva» debe ser al menos 2 y «paga» estar entre 1 y lleva − 1 (p. ej. 2x1 o 3x2).';
    case 'combo':
      return erroresDelCombo(valor);
  }
}

function erroresDelCombo(valor: Extract<ValorPromocion, { tipo: 'combo' }>): string | undefined {
  const ids = valor.productos.map((p) => p.productoId.trim());
  if (ids.some((id) => id === '')) return 'Cada producto del combo necesita un identificador.';
  if (new Set(ids).size !== ids.length)
    return 'Un producto aparece dos veces en el combo; indíquelo una vez con su cantidad.';
  if (!valor.productos.every((p) => esEntero(p.cantidad, 1)))
    return 'La cantidad de cada producto del combo debe ser un entero mayor que 0.';
  const unidades = valor.productos.reduce((total, p) => total + p.cantidad, 0);
  if (unidades < 2) return 'Un combo debe reunir al menos 2 unidades de productos.';
  if (!esEntero(valor.precioCentavos, 0))
    return 'El precio del combo debe ser un número entero de centavos mayor o igual a 0.';
  return undefined;
}

function erroresDelAlcance(alcance: Alcance, esCombo: boolean): string | undefined {
  const ids = [...alcance.productoIds, ...alcance.categoriaIds, ...alcance.menuIds];
  if (ids.some((id) => id.trim() === ''))
    return 'El alcance contiene un identificador vacío; quítelo o elija un elemento.';
  if (!esCombo && ids.length === 0)
    return 'Elija al menos un producto, categoría o menú al que se aplique la promoción.';
  return undefined;
}

export function validarPromocion(b: BorradorPromocion): ResultadoValidacion {
  const errores: ErrorCampo[] = [];
  const error = (campo: string, mensaje: string | undefined): void => {
    if (mensaje) errores.push({ campo, mensaje });
  };

  const nombre = b.nombre.trim();
  if (nombre.length < 3 || nombre.length > 80)
    error('nombre', 'El nombre debe tener entre 3 y 80 caracteres.');

  error('valor', erroresDelValor(b.valor));
  error('alcance', erroresDelAlcance(b.alcance, b.valor.tipo === 'combo'));

  if (!fechaValida(b.inicio)) error('inicio', 'Indique una fecha y hora de inicio válidas.');
  if (!fechaValida(b.fin)) error('fin', 'Indique una fecha y hora de fin válidas.');
  else if (fechaValida(b.inicio) && b.fin.getTime() <= b.inicio.getTime())
    error('fin', 'La fecha de fin debe ser posterior al inicio; cámbiela o adelante el inicio.');

  const etiqueta = b.etiquetaFestividad?.trim() ?? '';
  if (etiqueta.length > 40)
    error('etiquetaFestividad', 'La etiqueta de festividad admite como máximo 40 caracteres.');

  const prioridad = b.prioridad ?? 0;
  if (!esEntero(prioridad, 0, PRIORIDAD_MAXIMA))
    error('prioridad', `La prioridad debe ser un entero entre 0 y ${String(PRIORIDAD_MAXIMA)}.`);

  if (b.montoMinimoCentavos !== undefined && !esEntero(b.montoMinimoCentavos, 0))
    error('montoMinimoCentavos', 'El monto mínimo debe ser un número entero de centavos ≥ 0.');

  let cupon: Cupon | undefined;
  if (b.cupon) {
    const codigo = b.cupon.codigo.replace(/\s+/g, '').toUpperCase();
    if (!CODIGO_CUPON.test(codigo))
      error('cupon.codigo', 'El código de cupón debe tener de 4 a 32 letras, números o guiones.');
    const limite = b.cupon.limiteUsos;
    if (limite !== undefined && !esEntero(limite, 1))
      error(
        'cupon.limiteUsos',
        'El límite de usos debe ser un entero mayor que 0, o déjelo vacío.',
      );
    cupon = limite === undefined ? { codigo } : { codigo, limiteUsos: limite };
  }

  if (errores.length > 0) return { ok: false, errores };

  return {
    ok: true,
    valor: {
      nombre,
      valor: b.valor,
      alcance: b.alcance,
      inicio: b.inicio,
      fin: b.fin,
      prioridad,
      acumulable: b.acumulable ?? false,
      ...(etiqueta ? { etiquetaFestividad: etiqueta } : {}),
      ...(b.montoMinimoCentavos === undefined
        ? {}
        : { montoMinimoCentavos: b.montoMinimoCentavos }),
      ...(cupon ? { cupon } : {}),
    },
  };
}

// ── Estados ────────────────────────────────────────────────────────────────────

export type AccionEstado = 'pausar' | 'reanudar' | 'archivar';

export class TransicionNoPermitida extends Error {
  constructor(actual: EstadoPromocion, accion: AccionEstado) {
    super(`No se puede «${accion}» una promoción ${actual}.`);
    this.name = 'TransicionNoPermitida';
  }
}

const TRANSICIONES: Readonly<
  Record<AccionEstado, Partial<Record<EstadoPromocion, EstadoPromocion>>>
> = {
  pausar: { activa: 'pausada' },
  reanudar: { pausada: 'activa' },
  archivar: { activa: 'archivada', pausada: 'archivada' },
};

/** `activa ⇄ pausada`, `activa|pausada → archivada`; archivada es final. */
export function siguienteEstado(actual: EstadoPromocion, accion: AccionEstado): EstadoPromocion {
  const siguiente = TRANSICIONES[accion][actual];
  if (!siguiente) throw new TransicionNoPermitida(actual, accion);
  return siguiente;
}
