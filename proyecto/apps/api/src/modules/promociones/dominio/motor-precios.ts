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

import { centavos, descuentoPorcentual, repartirProporcional, type Centavos } from './dinero.js';
import { normalizarCupon } from './promocion.js';
import type {
  Cotizacion,
  EstadoCupon,
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
  if (promocion.valor.tipo === 'combo')
    return promocion.valor.productos.some((p) => p.productoId === linea.productoId);
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

/** Ordena de mayor a menor precio restante; `sort` es estable, así que el empate conserva el
 * orden de las ranuras (por productoId). */
const deMayorAMenor = (ranuras: readonly Ranura[]): Ranura[] =>
  [...ranuras].sort((a, b) => b.restante - a.restante);

/** N×M: en cada grupo completo de N unidades, las N−M más baratas salen gratis. */
function planificarNxM(ranuras: readonly Ranura[], lleva: number, paga: number): Aplicacion[] {
  const ordenadas = deMayorAMenor(ranuras);
  const completas = ordenadas.length - (ordenadas.length % lleva);
  // Todas las unidades del grupo quedan consumidas por la promoción, también las que se pagan.
  return ordenadas
    .slice(0, completas)
    .map((ranura, i) => ({ ranura, descuento: i % lleva >= paga ? ranura.restante : 0 }));
}

type ValorCombo = Extract<Promocion['valor'], { tipo: 'combo' }>;

/** Combo: forma tantos conjuntos completos como se pueda, con las unidades más caras primero, y
 * reparte el descuento de cada conjunto (suma − precio) proporcionalmente entre sus unidades. */
function planificarCombo(ranuras: readonly Ranura[], combo: ValorCombo): Aplicacion[] {
  const porProducto = combo.productos.map((p) => ({
    cantidad: p.cantidad,
    disponibles: deMayorAMenor(ranuras.filter((r) => r.linea.productoId === p.productoId)),
  }));
  const conjuntos = Math.min(
    ...porProducto.map((p) => Math.floor(p.disponibles.length / p.cantidad)),
  );
  const aplicaciones: Aplicacion[] = [];
  for (let k = 0; k < conjuntos; k += 1) {
    const conjunto = porProducto.flatMap((p) =>
      p.disponibles.slice(k * p.cantidad, (k + 1) * p.cantidad),
    );
    const precios = conjunto.map((r) => r.restante);
    const suma = precios.reduce((s, precio) => s + precio, 0);
    if (suma <= combo.precioCentavos) continue;
    repartirProporcional(suma - combo.precioCentavos, precios).forEach((descuento, i) => {
      aplicaciones.push({ ranura: conjunto[i] as Ranura, descuento });
    });
  }
  return aplicaciones;
}

const porUnidad = (ranuras: readonly Ranura[], descuento: (r: Ranura) => Centavos): Aplicacion[] =>
  ranuras
    .map((ranura) => ({ ranura, descuento: descuento(ranura) }))
    .filter((a) => a.descuento > 0);

/**
 * Unidades que usaría `promocion` en el estado actual de las ranuras y su descuento. Porcentaje y
 * monto fijo solo usan las unidades a las que descuentan algo; N×M y combo consumen todas las
 * unidades de cada grupo o conjunto completo, aunque alguna no reciba descuento (R5).
 */
function planificar(promocion: Promocion, ranuras: readonly Ranura[]): Aplicacion[] {
  const valor = promocion.valor;
  const elegibles = ranuras.filter(
    (ranura) => enAlcance(promocion, ranura.linea) && elegible(promocion, ranura),
  );
  switch (valor.tipo) {
    case 'porcentaje':
      return porUnidad(elegibles, (r) => descuentoPorcentual(r.restante, valor.puntosBasicos));
    case 'monto_fijo':
      return porUnidad(elegibles, (r) => Math.min(valor.centavos, r.restante));
    case 'nxm':
      return planificarNxM(elegibles, valor.lleva, valor.paga);
    case 'combo':
      return planificarCombo(elegibles, valor);
  }
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
  const promocionesAplicadas = agregar(registros, () => true);

  return {
    instante: instante.toISOString(),
    lineas: lineasCotizadas,
    subtotalCentavos: subtotal,
    descuentoCentavos: descuentoTotal,
    totalCentavos: subtotal - descuentoTotal,
    promocionesAplicadas,
    ...(cupon === undefined
      ? {}
      : { cupon: estadoCupon(cupon, promociones, instante, subtotal, promocionesAplicadas) }),
  };
}

/**
 * Estado del cupón introducido (contracts/promociones-api.md, «Estados del cupón»). Pausado,
 * archivado, terminado e inexistente responden igual, `no_valido`, para no revelar códigos.
 */
function estadoCupon(
  codigo: string,
  promociones: readonly Promocion[],
  instante: Date,
  subtotal: Centavos,
  aplicadas: readonly PromocionAplicada[],
): EstadoCupon {
  const promocion = promociones
    .filter((p) => p.estado === 'activa' && p.cupon?.codigo === codigo)
    .sort(porId)[0];
  const t = instante.getTime();
  if (!promocion || t >= promocion.fin.getTime()) return { estado: 'no_valido' };
  if (t < promocion.inicio.getTime()) return { estado: 'no_vigente' };
  const limite = promocion.cupon?.limiteUsos;
  if (limite !== undefined && promocion.usos >= limite) return { estado: 'agotado' };
  const minimo = promocion.montoMinimoCentavos;
  if (minimo !== undefined && subtotal < minimo)
    return { estado: 'monto_minimo', faltanteCentavos: minimo - subtotal };
  return aplicadas.some((p) => p.promocionId === promocion.id)
    ? { estado: 'aplicado', promocionId: promocion.id }
    : { estado: 'sin_efecto' };
}
