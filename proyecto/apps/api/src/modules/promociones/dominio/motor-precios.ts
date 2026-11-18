// Motor de precios: función pura y determinista (research.md R1 y R5).
// No lee base de datos, reloj ni caché: recibe las líneas, las promociones candidatas y el
// instante, y devuelve la cotización. El mismo carrito, las mismas promociones y el mismo
// instante producen siempre la misma cotización, sin importar el orden de entrada.
//
// Algoritmo (R5): cada unidad del carrito es una «ranura». Las promociones vigentes se agrupan
// por prioridad descendente; en cada nivel se aplica, una a una, la que más descuenta sobre las
// ranuras elegibles en ese momento (empate → id menor). Una no acumulable solo usa ranuras sin
// descuento y las bloquea; una acumulable usa ranuras no bloqueadas y descuenta sobre el precio
// restante.

import { centavos, descuentoPorcentual, type Centavos } from './dinero.js';
import { normalizarCupon } from './promocion.js';
import type {
  Cotizacion,
  LineaACotizar,
  LineaCotizada,
  Promocion,
  PromocionAplicada,
} from './tipos.js';
import { estaVigente } from './vigencia.js';

export class SolicitudInvalida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'SolicitudInvalida';
  }
}

export class TipoNoSoportado extends Error {
  constructor(tipo: string) {
    super(`El motor todavía no calcula promociones de tipo «${tipo}».`);
    this.name = 'TipoNoSoportado';
  }
}

export interface EntradaMotor {
  readonly lineas: readonly LineaACotizar[];
  readonly codigoCupon?: string;
}

interface Ranura {
  readonly linea: LineaACotizar;
  restante: Centavos;
  bloqueada: boolean;
  conDescuento: boolean;
}

interface Aplicacion {
  readonly ranura: Ranura;
  readonly descuento: Centavos;
}

interface Registro {
  readonly promocion: Promocion;
  readonly aplicaciones: readonly Aplicacion[];
}

const porId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function validarLineas(lineas: readonly LineaACotizar[]): LineaACotizar[] {
  const vistos = new Set<string>();
  for (const linea of lineas) {
    if (linea.productoId.trim() === '')
      throw new SolicitudInvalida('Cada línea necesita un productoId.');
    if (vistos.has(linea.productoId))
      throw new SolicitudInvalida(`Producto repetido en dos líneas: «${linea.productoId}».`);
    vistos.add(linea.productoId);
    if (!Number.isSafeInteger(linea.cantidad) || linea.cantidad < 1)
      throw new SolicitudInvalida(`Cantidad no válida para «${linea.productoId}».`);
    try {
      centavos(linea.precioBaseCentavos, 'precioBaseCentavos');
    } catch (error) {
      throw new SolicitudInvalida(`Precio no válido para «${linea.productoId}»: ${String(error)}`);
    }
  }
  return [...lineas].sort((a, b) => porId({ id: a.productoId }, { id: b.productoId }));
}

function enAlcance(promocion: Promocion, linea: LineaACotizar): boolean {
  const { productoIds, categoriaIds, menuIds } = promocion.alcance;
  return (
    productoIds.includes(linea.productoId) ||
    menuIds.includes(linea.menuId) ||
    linea.categoriaIds.some((id) => categoriaIds.includes(id))
  );
}

function esCandidata(
  promocion: Promocion,
  instante: Date,
  subtotal: Centavos,
  cupon: string | undefined,
): boolean {
  if (!estaVigente(promocion, instante)) return false;
  if (promocion.montoMinimoCentavos !== undefined && subtotal < promocion.montoMinimoCentavos)
    return false;
  if (promocion.cupon) {
    if (cupon !== promocion.cupon.codigo) return false;
    const limite = promocion.cupon.limiteUsos;
    if (limite !== undefined && promocion.usos >= limite) return false;
  }
  return true;
}

function elegible(promocion: Promocion, ranura: Ranura): boolean {
  if (ranura.bloqueada || ranura.restante === 0) return false;
  return promocion.acumulable || !ranura.conDescuento;
}

/** Descuentos que aplicaría `promocion` sobre las ranuras en su estado actual. */
function planificar(promocion: Promocion, ranuras: readonly Ranura[]): Aplicacion[] {
  const valor = promocion.valor;
  if (valor.tipo !== 'porcentaje') throw new TipoNoSoportado(valor.tipo);
  return ranuras
    .filter((ranura) => enAlcance(promocion, ranura.linea) && elegible(promocion, ranura))
    .map((ranura) => ({
      ranura,
      descuento: descuentoPorcentual(ranura.restante, valor.puntosBasicos),
    }))
    .filter((aplicacion) => aplicacion.descuento > 0);
}

const total = (aplicaciones: readonly Aplicacion[]): Centavos =>
  aplicaciones.reduce((suma, a) => suma + a.descuento, 0);

function aplicar(promocion: Promocion, aplicaciones: readonly Aplicacion[]): void {
  for (const { ranura, descuento } of aplicaciones) {
    ranura.restante -= descuento;
    ranura.conDescuento = true;
    if (!promocion.acumulable) ranura.bloqueada = true;
  }
}

function resolver(candidatas: readonly Promocion[], ranuras: readonly Ranura[]): Registro[] {
  const registros: Registro[] = [];
  const niveles = [...new Set(candidatas.map((p) => p.prioridad))].sort((a, b) => b - a);
  for (const nivel of niveles) {
    const pendientes = candidatas.filter((p) => p.prioridad === nivel);
    while (pendientes.length > 0) {
      let mejor = { indice: -1, aplicaciones: [] as Aplicacion[], beneficio: 0 };
      pendientes.forEach((promocion, indice) => {
        const aplicaciones = planificar(promocion, ranuras);
        const beneficio = total(aplicaciones);
        // `pendientes` está ordenado por id: solo un beneficio estrictamente mayor desplaza.
        if (beneficio > mejor.beneficio) mejor = { indice, aplicaciones, beneficio };
      });
      if (mejor.indice < 0) break;
      const [promocion] = pendientes.splice(mejor.indice, 1) as [Promocion];
      aplicar(promocion, mejor.aplicaciones);
      registros.push({ promocion, aplicaciones: mejor.aplicaciones });
    }
  }
  return registros;
}

function agregar(
  registros: readonly Registro[],
  filtro: (a: Aplicacion) => boolean,
): PromocionAplicada[] {
  return registros
    .map(({ promocion, aplicaciones }) => ({
      promocionId: promocion.id,
      nombre: promocion.nombre,
      descuentoCentavos: total(aplicaciones.filter(filtro)),
    }))
    .filter((p) => p.descuentoCentavos > 0)
    .sort((a, b) => porId({ id: a.promocionId }, { id: b.promocionId }));
}

export function calcularCotizacion(
  entrada: EntradaMotor,
  promociones: readonly Promocion[],
  instante: Date,
): Cotizacion {
  if (Number.isNaN(instante.getTime())) throw new SolicitudInvalida('Instante no válido.');
  const lineas = validarLineas(entrada.lineas);
  const ranuras: Ranura[] = lineas.flatMap((linea) =>
    Array.from({ length: linea.cantidad }, () => ({
      linea,
      restante: linea.precioBaseCentavos,
      bloqueada: false,
      conDescuento: false,
    })),
  );
  const subtotal = lineas.reduce((s, l) => s + l.precioBaseCentavos * l.cantidad, 0);
  const cupon =
    entrada.codigoCupon === undefined ? undefined : normalizarCupon(entrada.codigoCupon);
  const candidatas = promociones
    .filter((p) => esCandidata(p, instante, subtotal, cupon))
    .sort(porId);

  const registros = resolver(candidatas, ranuras);

  const lineasCotizadas: LineaCotizada[] = lineas.map((linea) => {
    const subtotalLinea = linea.precioBaseCentavos * linea.cantidad;
    const promocionesLinea = agregar(registros, (a) => a.ranura.linea === linea);
    const descuento = promocionesLinea.reduce((s, p) => s + p.descuentoCentavos, 0);
    return {
      productoId: linea.productoId,
      cantidad: linea.cantidad,
      precioBaseCentavos: linea.precioBaseCentavos,
      subtotalCentavos: subtotalLinea,
      descuentoCentavos: descuento,
      totalCentavos: subtotalLinea - descuento,
      promociones: promocionesLinea,
    };
  });
  const descuentoTotal = lineasCotizadas.reduce((s, l) => s + l.descuentoCentavos, 0);

  return {
    instante: instante.toISOString(),
    lineas: lineasCotizadas,
    subtotalCentavos: subtotal,
    descuentoCentavos: descuentoTotal,
    totalCentavos: subtotal - descuentoTotal,
    promocionesAplicadas: agregar(registros, () => true),
  };
}
