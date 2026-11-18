import { describe, expect, it } from '@jest/globals';
import { SolicitudInvalida, calcularCotizacion } from './motor-precios.js';
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
});

const soloCafe = { productoIds: ['cafe'], categoriaIds: [], menuIds: [] };
const descuentos = (c: ReturnType<typeof calcularCotizacion>): Record<string, number> =>
  Object.fromEntries(c.lineas.map((l) => [l.productoId, l.descuentoCentavos]));

describe('calcularCotizacion — monto fijo (T012, US2.2)', () => {
  it('descuenta el monto por unidad', () => {
    const p = promo({ id: 'p', alcance: soloCafe, valor: { tipo: 'monto_fijo', centavos: 50 } });
    expect(calcularCotizacion({ lineas: [cafe] }, [p], DENTRO).descuentoCentavos).toBe(100);
  });

  it('un monto mayor que el precio deja el precio en 0, nunca negativo', () => {
    const p = promo({ id: 'p', alcance: soloCafe, valor: { tipo: 'monto_fijo', centavos: 300 } });
    const c = calcularCotizacion({ lineas: [cafe] }, [p], DENTRO);
    expect(c.lineas[0]).toMatchObject({ descuentoCentavos: 500, totalCentavos: 0 });
  });

  it('acumulado tras un porcentaje se limita al precio restante', () => {
    const pct = promo({ id: 'a', acumulable: true, prioridad: 5 });
    const fijo = promo({
      id: 'b',
      acumulable: true,
      alcance: soloCafe,
      valor: { tipo: 'monto_fijo', centavos: 300 },
    });
    const c = calcularCotizacion({ lineas: [cafe] }, [pct, fijo], DENTRO);
    expect(c.totalCentavos).toBe(0);
    expect(c.lineas[0]?.promociones.map((p) => p.descuentoCentavos)).toEqual([100, 400]);
  });
});

describe('calcularCotizacion — N×M (T013, US2.3)', () => {
  const dosPorUno = { tipo: 'nxm', lleva: 2, paga: 1 } as const;
  const tresPorDos = { tipo: 'nxm', lleva: 3, paga: 2 } as const;
  const te: LineaACotizar = { ...cafe, productoId: 'te', cantidad: 1, precioBaseCentavos: 200 };

  it.each([
    ['2x1 con 3 unidades paga 2', dosPorUno, 3, 250],
    ['2x1 con 1 unidad no descuenta', dosPorUno, 1, 0],
    ['2x1 con 4 unidades paga 2', dosPorUno, 4, 500],
    ['3x2 con 3 unidades paga 2', tresPorDos, 3, 250],
    ['3x2 con 5 unidades paga 4', tresPorDos, 5, 250],
    ['3x2 con 6 unidades paga 4', tresPorDos, 6, 500],
  ] as const)('%s', (_caso, valor, cantidad, descuento) => {
    const p = promo({ id: 'p', alcance: soloCafe, valor });
    const c = calcularCotizacion({ lineas: [{ ...cafe, cantidad }] }, [p], DENTRO);
    expect(c.descuentoCentavos).toBe(descuento);
    expect(c.promocionesAplicadas.length).toBe(descuento > 0 ? 1 : 0);
  });

  it('con productos distintos de la categoría, la unidad gratis es la más barata del grupo', () => {
    const p = promo({ id: 'p', valor: dosPorUno });
    const c = calcularCotizacion({ lineas: [{ ...cafe, cantidad: 1 }, te] }, [p], DENTRO);
    expect(descuentos(c)).toEqual({ cafe: 0, te: 200 });
  });

  it('los grupos se forman de mayor a menor precio', () => {
    // 250, 250, 200 → grupo [250, 250] deja gratis un café; el té queda sin grupo
    const p = promo({ id: 'p', valor: dosPorUno });
    const c = calcularCotizacion({ lineas: [cafe, te] }, [p], DENTRO);
    expect(descuentos(c)).toEqual({ cafe: 250, te: 0 });
  });
});

describe('calcularCotizacion — combo (T014, US2.4)', () => {
  const sanduche: LineaACotizar = {
    productoId: 'sanduche',
    categoriaIds: ['salados'],
    menuId: 'desayuno',
    cantidad: 1,
    precioBaseCentavos: 400,
  };
  const comboValor = (precioCentavos: number) =>
    ({
      tipo: 'combo',
      productos: [
        { productoId: 'cafe', cantidad: 1 },
        { productoId: 'sanduche', cantidad: 1 },
      ],
      precioCentavos,
    }) as const;
  const sinAlcance = { productoIds: [], categoriaIds: [], menuIds: [] };
  const combo = (precio = 500) =>
    promo({ id: 'combo', alcance: sinAlcance, valor: comboValor(precio) });

  it('café + sánduche a 5,00: reparte 1,50 proporcionalmente y exacto', () => {
    const c = calcularCotizacion(
      { lineas: [{ ...cafe, cantidad: 1 }, sanduche] },
      [combo()],
      DENTRO,
    );
    // 150 × 250/650 = 57,7 → 57 (+1 sobrante por orden) = 58; 150 × 400/650 = 92,3 → 92
    expect(descuentos(c)).toEqual({ cafe: 58, sanduche: 92 });
    expect(c.totalCentavos).toBe(500);
  });

  it('se aplica tantas veces como se complete', () => {
    const c = calcularCotizacion(
      { lineas: [cafe, { ...sanduche, cantidad: 2 }] },
      [combo()],
      DENTRO,
    );
    expect(c.descuentoCentavos).toBe(300);
  });

  it('un conjunto incompleto no recibe descuento', () => {
    const c = calcularCotizacion({ lineas: [cafe, sanduche] }, [combo()], DENTRO);
    expect(c.descuentoCentavos).toBe(150);
    expect(calcularCotizacion({ lineas: [cafe] }, [combo()], DENTRO).descuentoCentavos).toBe(0);
  });

  it('no se aplica si el precio del combo no es menor que la suma', () => {
    const c = calcularCotizacion(
      { lineas: [{ ...cafe, cantidad: 1 }, sanduche] },
      [combo(650)],
      DENTRO,
    );
    expect(c.descuentoCentavos).toBe(0);
  });

  it('admite varias unidades del mismo producto', () => {
    const valor = {
      tipo: 'combo',
      productos: [{ productoId: 'cafe', cantidad: 2 }],
      precioCentavos: 400,
    } as const;
    const p = promo({ id: 'p', alcance: sinAlcance, valor });
    const c = calcularCotizacion({ lineas: [{ ...cafe, cantidad: 3 }] }, [p], DENTRO);
    expect(c.descuentoCentavos).toBe(100);
  });

  it('las unidades del combo no acumulable no reciben otras promociones', () => {
    const pct = promo({ id: 'pct' }); // 20 % en calientes, misma prioridad
    const c = calcularCotizacion({ lineas: [cafe, sanduche] }, [combo(), pct], DENTRO);
    // combo (150) gana a 20 % sobre dos cafés (100); el café sobrante sí recibe el 20 %
    expect(c.promocionesAplicadas).toEqual([
      { promocionId: 'combo', nombre: 'Promo combo', descuentoCentavos: 150 },
      { promocionId: 'pct', nombre: 'Promo pct', descuentoCentavos: 50 },
    ]);
  });
});

describe('calcularCotizacion — estado del cupón (T017, US4.1-3)', () => {
  const navidad = promo({ id: 'nav', cupon: { codigo: 'NAVIDAD' } });
  const estado = (promociones: Promocion[], codigoCupon: string, lineas = [cafe]) =>
    calcularCotizacion({ lineas, codigoCupon }, promociones, DENTRO).cupon;

  it('sin código no informa estado de cupón', () => {
    expect('cupon' in calcularCotizacion({ lineas: [cafe] }, [navidad], DENTRO)).toBe(false);
  });

  it('US4.1: un cupón válido que descuenta queda aplicado (código normalizado)', () => {
    expect(estado([navidad], ' navidad ')).toEqual({ estado: 'aplicado', promocionId: 'nav' });
  });

  it.each([
    ['desconocido', [navidad], 'OTRO'],
    ['vacío', [navidad], ''],
    ['de una promoción pausada', [{ ...navidad, estado: 'pausada' as const }], 'NAVIDAD'],
    ['de una promoción archivada', [{ ...navidad, estado: 'archivada' as const }], 'NAVIDAD'],
    [
      'de una promoción terminada',
      [{ ...navidad, fin: new Date('2026-12-21T00:00:00Z') }],
      'NAVIDAD',
    ],
  ])('un código %s no es válido', (_caso, promociones, codigo) => {
    expect(estado(promociones, codigo)).toEqual({ estado: 'no_valido' });
  });

  it('una promoción archivada con el mismo código no oculta a la activa', () => {
    const vieja = promo({ id: 'a-vieja', estado: 'archivada', cupon: { codigo: 'NAVIDAD' } });
    expect(estado([vieja, navidad], 'NAVIDAD')).toEqual({ estado: 'aplicado', promocionId: 'nav' });
  });

  it('un cupón cuya ventana aún no empieza no está vigente', () => {
    const futura = { ...navidad, inicio: new Date('2026-12-24T00:00:00Z') };
    expect(estado([futura], 'NAVIDAD')).toEqual({ estado: 'no_vigente' });
  });

  it('US4.3: un cupón con los usos agotados', () => {
    const agotado = { ...navidad, cupon: { codigo: 'NAVIDAD', limiteUsos: 3 }, usos: 3 };
    expect(estado([agotado], 'NAVIDAD')).toEqual({ estado: 'agotado' });
  });

  it('US4.2: por debajo del monto mínimo indica cuánto falta', () => {
    const conMinimo = { ...navidad, montoMinimoCentavos: 1000 };
    expect(estado([conMinimo], 'NAVIDAD')).toEqual({
      estado: 'monto_minimo',
      faltanteCentavos: 500,
    });
    expect(estado([conMinimo], 'NAVIDAD', [{ ...cafe, cantidad: 4 }])).toEqual({
      estado: 'aplicado',
      promocionId: 'nav',
    });
  });

  it('agotado se informa antes que el monto mínimo', () => {
    const ambos = {
      ...navidad,
      montoMinimoCentavos: 1000,
      cupon: { codigo: 'NAVIDAD', limiteUsos: 1 },
      usos: 1,
    };
    expect(estado([ambos], 'NAVIDAD')).toEqual({ estado: 'agotado' });
  });

  it('válido pero sin productos en su alcance → sin efecto', () => {
    expect(estado([navidad], 'NAVIDAD', [jugo])).toEqual({ estado: 'sin_efecto' });
  });

  it('válido pero superado por una promoción de mayor prioridad → sin efecto', () => {
    const fuerte = promo({
      id: 'fuerte',
      prioridad: 5,
      valor: { tipo: 'porcentaje', puntosBasicos: 5000 },
    });
    const c = calcularCotizacion(
      { lineas: [cafe], codigoCupon: 'NAVIDAD' },
      [navidad, fuerte],
      DENTRO,
    );
    expect(c.cupon).toEqual({ estado: 'sin_efecto' });
    expect(c.promocionesAplicadas.map((p) => p.promocionId)).toEqual(['fuerte']);
  });
});
