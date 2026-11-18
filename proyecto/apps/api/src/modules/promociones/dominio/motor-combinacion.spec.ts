// Batería de combinaciones (T015-T016, US3, SC-002). Cada resultado esperado está calculado a
// mano con las reglas de research.md R5; si un cambio del motor altera un caso, el cambio se
// justifica en R5 antes de tocar este archivo.
import { describe, expect, it } from '@jest/globals';
import { calcularCotizacion } from './motor-precios.js';
import type { LineaACotizar, Promocion, ValorPromocion } from './tipos.js';

const AHORA = new Date('2026-12-23T15:00:00.000Z');

const producto =
  (productoId: string, categoriaIds: string[], menuId: string, precioBaseCentavos: number) =>
  (cantidad: number): LineaACotizar => ({
    productoId,
    categoriaIds,
    menuId,
    cantidad,
    precioBaseCentavos,
  });

const cafe = producto('cafe', ['calientes'], 'desayuno', 250);
const te = producto('te', ['calientes'], 'desayuno', 200);
const capuchino = producto('capuchino', ['calientes', 'especiales'], 'tarde', 300);
const jugo = producto('jugo', ['frias'], 'desayuno', 300);
const sanduche = producto('sanduche', ['salados'], 'desayuno', 400);
const torta = producto('torta', ['postres'], 'tarde', 350);

const ninguno = { productoIds: [], categoriaIds: [], menuIds: [] };

function promo(
  id: string,
  valor: ValorPromocion,
  alcance: Partial<Promocion['alcance']>,
  extra: Partial<Promocion> = {},
): Promocion {
  return {
    id,
    nombre: id,
    valor,
    alcance: { ...ninguno, ...alcance },
    inicio: new Date('2026-12-20T05:00:00.000Z'),
    fin: new Date('2026-12-26T05:00:00.000Z'),
    prioridad: 0,
    acumulable: false,
    usos: 0,
    estado: 'activa',
    version: 1,
    ...extra,
  };
}

const pct = (puntosBasicos: number): ValorPromocion => ({ tipo: 'porcentaje', puntosBasicos });

const cal20 = promo('cal20', pct(2000), { categoriaIds: ['calientes'] });
const esp10 = promo('esp10', pct(1000), { categoriaIds: ['especiales'] });
const espAcc15 = promo(
  'espacc15',
  pct(1500),
  { categoriaIds: ['especiales'] },
  { acumulable: true },
);
const tarde100 = promo(
  'tarde100',
  { tipo: 'monto_fijo', centavos: 100 },
  { menuIds: ['tarde'] },
  { prioridad: 2 },
);
const te2x1 = promo(
  'te2x1',
  { tipo: 'nxm', lleva: 2, paga: 1 },
  { productoIds: ['te'] },
  { prioridad: 1 },
);
const cal2x1 = promo('cal2x1', { tipo: 'nxm', lleva: 2, paga: 1 }, { categoriaIds: ['calientes'] });
const combo = promo(
  'combo',
  {
    tipo: 'combo',
    productos: [
      { productoId: 'cafe', cantidad: 1 },
      { productoId: 'sanduche', cantidad: 1 },
    ],
    precioCentavos: 500,
  },
  {},
);
const des5Acc = promo('des5acc', pct(500), { menuIds: ['desayuno'] }, { acumulable: true });
const jugo30 = promo(
  'jugo30',
  pct(3000),
  { productoIds: ['jugo'] },
  { cupon: { codigo: 'JUGO30' } },
);
const min50 = promo(
  'min50',
  { tipo: 'monto_fijo', centavos: 50 },
  { productoIds: ['sanduche'] },
  { montoMinimoCentavos: 1000 },
);
const prio = (p: Promocion, prioridad: number): Promocion => ({ ...p, prioridad });

interface Caso {
  readonly nombre: string;
  readonly lineas: LineaACotizar[];
  readonly promociones: Promocion[];
  readonly cupon?: string;
  readonly descuento: number;
  readonly aplicadas: string[];
}

const casos: Caso[] = [
  {
    nombre: '01 porcentaje simple',
    lineas: [cafe(1)],
    promociones: [cal20],
    descuento: 50,
    aplicadas: ['cal20'],
  },
  {
    nombre: '02 producto en dos categorías: gana la más favorable',
    lineas: [capuchino(1)],
    promociones: [cal20, esp10],
    descuento: 60,
    aplicadas: ['cal20'],
  },
  {
    nombre: '03 no acumulable más favorable bloquea a la acumulable',
    lineas: [capuchino(1)],
    promociones: [cal20, espAcc15],
    descuento: 60,
    aplicadas: ['cal20'],
  },
  {
    nombre: '04 acumulable de mayor prioridad excluye a la no acumulable',
    lineas: [capuchino(1)],
    promociones: [cal20, prio(espAcc15, 1)],
    descuento: 45,
    aplicadas: ['espacc15'],
  },
  {
    nombre: '05 mayor prioridad gana aunque descuente igual o más',
    lineas: [capuchino(1)],
    promociones: [tarde100, cal20],
    descuento: 100,
    aplicadas: ['tarde100'],
  },
  {
    nombre: '06 monto fijo por menú',
    lineas: [torta(1)],
    promociones: [tarde100],
    descuento: 100,
    aplicadas: ['tarde100'],
  },
  {
    nombre: '07 2x1 con 3 unidades',
    lineas: [te(3)],
    promociones: [te2x1],
    descuento: 200,
    aplicadas: ['te2x1'],
  },
  {
    nombre: '08 2x1 consume su grupo; la unidad sobrante recibe el 20 %',
    lineas: [te(3)],
    promociones: [te2x1, cal20],
    descuento: 240,
    aplicadas: ['cal20', 'te2x1'],
  },
  {
    nombre: '09 combo',
    lineas: [cafe(1), sanduche(1)],
    promociones: [combo],
    descuento: 150,
    aplicadas: ['combo'],
  },
  {
    nombre: '10 combo más favorable que el porcentaje',
    lineas: [cafe(1), sanduche(1)],
    promociones: [combo, cal20],
    descuento: 150,
    aplicadas: ['combo'],
  },
  {
    nombre: '11 porcentaje de mayor prioridad rompe el combo',
    lineas: [cafe(1), sanduche(1)],
    promociones: [combo, prio(cal20, 1)],
    descuento: 50,
    aplicadas: ['cal20'],
  },
  {
    nombre: '12 combo bloquea a la acumulable de igual prioridad',
    lineas: [cafe(1), sanduche(1)],
    promociones: [combo, des5Acc],
    descuento: 150,
    aplicadas: ['combo'],
  },
  {
    nombre: '13 acumulable de mayor prioridad impide el combo',
    lineas: [cafe(1), sanduche(1)],
    promociones: [combo, prio(des5Acc, 1)],
    descuento: 33,
    aplicadas: ['des5acc'],
  },
  {
    nombre: '14 cupón no introducido',
    lineas: [jugo(1)],
    promociones: [jugo30],
    descuento: 0,
    aplicadas: [],
  },
  {
    nombre: '15 cupón introducido en minúsculas',
    lineas: [jugo(1)],
    promociones: [jugo30],
    cupon: 'jugo30',
    descuento: 90,
    aplicadas: ['jugo30'],
  },
  {
    nombre: '16 monto mínimo alcanzado',
    lineas: [sanduche(2), jugo(1)],
    promociones: [min50],
    descuento: 100,
    aplicadas: ['min50'],
  },
  {
    nombre: '17 monto mínimo no alcanzado',
    lineas: [sanduche(2)],
    promociones: [min50],
    descuento: 0,
    aplicadas: [],
  },
  {
    nombre: '18 igual prioridad: la de mayor beneficio total',
    lineas: [cafe(2), te(1)],
    promociones: [cal20, des5Acc],
    descuento: 140,
    aplicadas: ['cal20'],
  },
  {
    nombre: '19 promoción sin productos en su alcance no aparece',
    lineas: [jugo(1), sanduche(1)],
    promociones: [des5Acc, cal20],
    descuento: 35,
    aplicadas: ['des5acc'],
  },
  {
    nombre: '20 tres promociones de tipos distintos',
    lineas: [capuchino(2), te(2)],
    promociones: [esp10, te2x1, cal20],
    descuento: 320,
    aplicadas: ['cal20', 'te2x1'],
  },
  {
    nombre: '21 monto fijo sobre varias líneas del menú',
    lineas: [torta(2), capuchino(1)],
    promociones: [tarde100],
    descuento: 300,
    aplicadas: ['tarde100'],
  },
  {
    nombre: '22 2x1 más favorable que 20 % y consume todo',
    lineas: [cafe(4)],
    promociones: [cal2x1, cal20],
    descuento: 500,
    aplicadas: ['cal2x1'],
  },
  {
    nombre: '23 2x1 y la unidad sin grupo recibe el 20 %',
    lineas: [cafe(3)],
    promociones: [cal2x1, cal20],
    descuento: 300,
    aplicadas: ['cal20', 'cal2x1'],
  },
];

const cotizar = (lineas: LineaACotizar[], promociones: Promocion[], cupon?: string) =>
  calcularCotizacion(
    cupon === undefined ? { lineas } : { lineas, codigoCupon: cupon },
    promociones,
    AHORA,
  );

describe('batería de combinaciones (SC-002)', () => {
  it.each(casos)('$nombre', ({ lineas, promociones, cupon, descuento, aplicadas }) => {
    const c = cotizar(lineas, promociones, cupon);
    expect(c.descuentoCentavos).toBe(descuento);
    expect(c.promocionesAplicadas.map((p) => p.promocionId)).toEqual(aplicadas);
    expect(c.totalCentavos).toBe(c.subtotalCentavos - descuento);
    expect(c.lineas.every((l) => l.totalCentavos >= 0)).toBe(true);
  });

  it('US3.3: cada caso da el mismo resultado al permutar y repetir la entrada', () => {
    for (const { lineas, promociones, cupon } of casos) {
      const referencia = cotizar(lineas, promociones, cupon);
      expect(cotizar([...lineas].reverse(), [...promociones].reverse(), cupon)).toEqual(referencia);
      expect(cotizar(lineas, [...promociones.slice(1), ...promociones.slice(0, 1)], cupon)).toEqual(
        referencia,
      );
      expect(cotizar(lineas, promociones, cupon)).toEqual(referencia);
    }
  });

  it('la suma de descuentos por línea coincide con la de las promociones aplicadas', () => {
    for (const { lineas, promociones, cupon } of casos) {
      const c = cotizar(lineas, promociones, cupon);
      const porLineas = c.lineas
        .flatMap((l) => l.promociones)
        .reduce((s, p) => s + p.descuentoCentavos, 0);
      const porPromocion = c.promocionesAplicadas.reduce((s, p) => s + p.descuentoCentavos, 0);
      expect(porLineas).toBe(c.descuentoCentavos);
      expect(porPromocion).toBe(c.descuentoCentavos);
    }
  });
});
