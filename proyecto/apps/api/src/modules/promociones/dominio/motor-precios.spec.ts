import { describe, expect, it } from '@jest/globals';
import { SolicitudInvalida, TipoNoSoportado, calcularCotizacion } from './motor-precios.js';
import type { LineaACotizar, Promocion } from './tipos.js';

const DENTRO = new Date('2026-12-23T15:00:00.000Z');
const ANTES = new Date('2026-12-20T04:59:59.999Z');
const FIN = new Date('2026-12-26T05:00:00.000Z');

function promo(cambios: Partial<Promocion> & { id: string }): Promocion {
  return {
    nombre: `Promo ${cambios.id}`,
    valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
    alcance: { productoIds: [], categoriaIds: ['calientes'], menuIds: [] },
    inicio: new Date('2026-12-20T05:00:00.000Z'),
    fin: FIN,
    prioridad: 0,
    acumulable: false,
    usos: 0,
    estado: 'activa',
    version: 1,
    ...cambios,
  };
}

const cafe: LineaACotizar = {
  productoId: 'cafe',
  categoriaIds: ['calientes'],
  menuId: 'desayuno',
  cantidad: 2,
  precioBaseCentavos: 250,
};
const jugo: LineaACotizar = {
  productoId: 'jugo',
  categoriaIds: ['frias'],
  menuId: 'desayuno',
  cantidad: 1,
  precioBaseCentavos: 300,
};
const pan: LineaACotizar = {
  productoId: 'pan',
  categoriaIds: ['panaderia'],
  menuId: 'tarde',
  cantidad: 3,
  precioBaseCentavos: 105,
};

describe('calcularCotizacion — sin promociones', () => {
  it('devuelve subtotales y total sin descuento, con el instante del cálculo', () => {
    const c = calcularCotizacion({ lineas: [cafe, jugo] }, [], DENTRO);
    expect(c).toEqual({
      instante: '2026-12-23T15:00:00.000Z',
      lineas: [
        {
          productoId: 'cafe',
          cantidad: 2,
          precioBaseCentavos: 250,
          subtotalCentavos: 500,
          descuentoCentavos: 0,
          totalCentavos: 500,
          promociones: [],
        },
        {
          productoId: 'jugo',
          cantidad: 1,
          precioBaseCentavos: 300,
          subtotalCentavos: 300,
          descuentoCentavos: 0,
          totalCentavos: 300,
          promociones: [],
        },
      ],
      subtotalCentavos: 800,
      descuentoCentavos: 0,
      totalCentavos: 800,
      promocionesAplicadas: [],
    });
  });

  it('acepta un carrito vacío', () => {
    const c = calcularCotizacion({ lineas: [] }, [], DENTRO);
    expect(c.totalCentavos).toBe(0);
    expect(c.lineas).toEqual([]);
  });
});

describe('calcularCotizacion — porcentaje y vigencia (US1, US2.1)', () => {
  it('US2.1: 20 % sobre una categoría se aplica a cada unidad de esa categoría', () => {
    const c = calcularCotizacion({ lineas: [cafe, jugo] }, [promo({ id: 'p1' })], DENTRO);
    expect(c.lineas[0]).toMatchObject({
      productoId: 'cafe',
      subtotalCentavos: 500,
      descuentoCentavos: 100,
      totalCentavos: 400,
      promociones: [{ promocionId: 'p1', nombre: 'Promo p1', descuentoCentavos: 100 }],
    });
    expect(c.lineas[1]).toMatchObject({ productoId: 'jugo', descuentoCentavos: 0 });
    expect(c).toMatchObject({ subtotalCentavos: 800, descuentoCentavos: 100, totalCentavos: 700 });
    expect(c.promocionesAplicadas).toEqual([
      { promocionId: 'p1', nombre: 'Promo p1', descuentoCentavos: 100 },
    ]);
  });

  it.each([
    ['producto', { productoIds: ['jugo'], categoriaIds: [], menuIds: [] }, 'jugo', 60],
    ['menú', { productoIds: [], categoriaIds: [], menuIds: ['tarde'] }, 'pan', 63],
  ])('alcance por %s', (_caso, alcance, productoId, descuento) => {
    const c = calcularCotizacion(
      { lineas: [cafe, jugo, pan] },
      [promo({ id: 'p', alcance })],
      DENTRO,
    );
    const afectadas = c.lineas.filter((l) => l.descuentoCentavos > 0);
    expect(afectadas.map((l) => [l.productoId, l.descuentoCentavos])).toEqual([
      [productoId, descuento],
    ]);
  });

  it('redondea por unidad: 10 % de 1,05 = 0,11 por unidad, 0,33 en 3 unidades', () => {
    const alcance = { productoIds: ['pan'], categoriaIds: [], menuIds: [] };
    const valor = { tipo: 'porcentaje', puntosBasicos: 1000 } as const;
    const c = calcularCotizacion({ lineas: [pan] }, [promo({ id: 'p', alcance, valor })], DENTRO);
    expect(c.lineas[0]?.descuentoCentavos).toBe(33);
  });

  it.each([
    ['antes del inicio (US1.3)', ANTES],
    ['justo en el fin (US1.2)', FIN],
  ])('no se aplica %s', (_caso, instante) => {
    const c = calcularCotizacion({ lineas: [cafe] }, [promo({ id: 'p1' })], instante);
    expect(c.descuentoCentavos).toBe(0);
    expect(c.promocionesAplicadas).toEqual([]);
  });

  it.each(['pausada', 'archivada'] as const)('una promoción %s no se aplica', (estado) => {
    const c = calcularCotizacion({ lineas: [cafe] }, [promo({ id: 'p1', estado })], DENTRO);
    expect(c.descuentoCentavos).toBe(0);
  });

  it('el precio final nunca es negativo con 100 %', () => {
    const valor = { tipo: 'porcentaje', puntosBasicos: 10_000 } as const;
    const c = calcularCotizacion({ lineas: [cafe] }, [promo({ id: 'p', valor })], DENTRO);
    expect(c.totalCentavos).toBe(0);
  });
});

describe('calcularCotizacion — condiciones de candidatura', () => {
  it('monto mínimo sobre el subtotal bruto', () => {
    const p = promo({ id: 'p', montoMinimoCentavos: 800 });
    expect(calcularCotizacion({ lineas: [cafe, jugo] }, [p], DENTRO).descuentoCentavos).toBe(100);
    expect(calcularCotizacion({ lineas: [cafe] }, [p], DENTRO).descuentoCentavos).toBe(0);
  });

  it('una promoción con cupón solo se aplica con su código (normalizado)', () => {
    const p = promo({ id: 'p', cupon: { codigo: 'NAVIDAD' } });
    expect(calcularCotizacion({ lineas: [cafe] }, [p], DENTRO).descuentoCentavos).toBe(0);
    expect(
      calcularCotizacion({ lineas: [cafe], codigoCupon: ' navidad ' }, [p], DENTRO)
        .descuentoCentavos,
    ).toBe(100);
    expect(
      calcularCotizacion({ lineas: [cafe], codigoCupon: 'OTRO' }, [p], DENTRO).descuentoCentavos,
    ).toBe(0);
  });

  it('un cupón con los usos agotados no se aplica', () => {
    const p = promo({ id: 'p', cupon: { codigo: 'NAVIDAD', limiteUsos: 5 }, usos: 5 });
    const c = calcularCotizacion({ lineas: [cafe], codigoCupon: 'NAVIDAD' }, [p], DENTRO);
    expect(c.descuentoCentavos).toBe(0);
  });
});

describe('calcularCotizacion — prioridad y acumulación entre porcentajes', () => {
  it('dos no acumulables: gana la de mayor prioridad aunque descuente menos', () => {
    const p10 = promo({
      id: 'b',
      prioridad: 10,
      valor: { tipo: 'porcentaje', puntosBasicos: 1000 },
    });
    const p0 = promo({ id: 'a', prioridad: 0, valor: { tipo: 'porcentaje', puntosBasicos: 5000 } });
    const c = calcularCotizacion({ lineas: [cafe] }, [p0, p10], DENTRO);
    expect(c.promocionesAplicadas.map((p) => p.promocionId)).toEqual(['b']);
    expect(c.descuentoCentavos).toBe(50);
  });

  it('igual prioridad: gana la más favorable; empate total → menor id', () => {
    const p20 = promo({ id: 'z' });
    const p30 = promo({ id: 'y', valor: { tipo: 'porcentaje', puntosBasicos: 3000 } });
    expect(calcularCotizacion({ lineas: [cafe] }, [p20, p30], DENTRO).promocionesAplicadas).toEqual(
      [{ promocionId: 'y', nombre: 'Promo y', descuentoCentavos: 150 }],
    );
    const gemela = promo({ id: 'x' });
    expect(
      calcularCotizacion({ lineas: [cafe] }, [p20, gemela], DENTRO).promocionesAplicadas[0]
        ?.promocionId,
    ).toBe('x');
  });

  it('acumulables se encadenan sobre el precio restante', () => {
    const a = promo({ id: 'a', acumulable: true, prioridad: 5 }); // 20 %
    const b = promo({
      id: 'b',
      acumulable: true,
      valor: { tipo: 'porcentaje', puntosBasicos: 1000 },
    });
    const c = calcularCotizacion({ lineas: [cafe] }, [a, b], DENTRO);
    // por unidad: 250 − 50 = 200; 10 % de 200 = 20 → 180; dos unidades: 140 de descuento
    expect(c.descuentoCentavos).toBe(140);
    expect(c.lineas[0]?.promociones).toEqual([
      { promocionId: 'a', nombre: 'Promo a', descuentoCentavos: 100 },
      { promocionId: 'b', nombre: 'Promo b', descuentoCentavos: 40 },
    ]);
  });

  it('una no acumulable de mayor prioridad bloquea las acumulables', () => {
    const fuerte = promo({ id: 'n', prioridad: 9 });
    const acumulable = promo({ id: 'a', acumulable: true });
    const c = calcularCotizacion({ lineas: [cafe] }, [acumulable, fuerte], DENTRO);
    expect(c.promocionesAplicadas.map((p) => p.promocionId)).toEqual(['n']);
  });

  it('una acumulable de mayor prioridad impide aplicar después una no acumulable', () => {
    const acumulable = promo({ id: 'a', acumulable: true, prioridad: 9 });
    const noAcumulable = promo({ id: 'n', valor: { tipo: 'porcentaje', puntosBasicos: 5000 } });
    const c = calcularCotizacion({ lineas: [cafe] }, [noAcumulable, acumulable], DENTRO);
    expect(c.promocionesAplicadas.map((p) => p.promocionId)).toEqual(['a']);
  });
});

describe('calcularCotizacion — determinismo (US3.3)', () => {
  it('el orden de líneas y promociones no cambia el resultado', () => {
    const promos = [
      promo({ id: 'a', acumulable: true }),
      promo({
        id: 'b',
        prioridad: 3,
        alcance: { productoIds: ['pan'], categoriaIds: [], menuIds: [] },
      }),
      promo({ id: 'c', acumulable: true, valor: { tipo: 'porcentaje', puntosBasicos: 1500 } }),
    ];
    const referencia = calcularCotizacion({ lineas: [cafe, jugo, pan] }, promos, DENTRO);
    const invertida = calcularCotizacion(
      { lineas: [pan, jugo, cafe] },
      [...promos].reverse(),
      DENTRO,
    );
    expect(invertida).toEqual(referencia);
    expect(calcularCotizacion({ lineas: [cafe, jugo, pan] }, promos, DENTRO)).toEqual(referencia);
  });
});

describe('calcularCotizacion — entradas inválidas', () => {
  it.each([
    ['cantidad 0', { ...cafe, cantidad: 0 }],
    ['cantidad decimal', { ...cafe, cantidad: 1.5 }],
    ['precio negativo', { ...cafe, precioBaseCentavos: -1 }],
    ['precio decimal', { ...cafe, precioBaseCentavos: 2.5 }],
    ['producto vacío', { ...cafe, productoId: ' ' }],
  ])('rechaza %s', (_caso, linea) => {
    expect(() => calcularCotizacion({ lineas: [linea] }, [], DENTRO)).toThrow(SolicitudInvalida);
  });

  it('rechaza un producto repetido en dos líneas', () => {
    expect(() => calcularCotizacion({ lineas: [cafe, cafe] }, [], DENTRO)).toThrow(/repetido/);
  });

  it('rechaza un instante inválido', () => {
    expect(() => calcularCotizacion({ lineas: [cafe] }, [], new Date(Number.NaN))).toThrow(
      SolicitudInvalida,
    );
  });

  it('avisa de los tipos que aún no calcula en lugar de ignorarlos en silencio', () => {
    const p = promo({ id: 'p', valor: { tipo: 'monto_fijo', centavos: 50 } });
    expect(() => calcularCotizacion({ lineas: [cafe] }, [p], DENTRO)).toThrow(TipoNoSoportado);
  });
});
