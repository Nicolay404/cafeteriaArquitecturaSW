import { describe, expect, it } from '@jest/globals';
import {
  ImporteInvalido,
  centavos,
  descuentoPorcentual,
  puntosBasicos,
  repartirProporcional,
} from './dinero.js';

describe('centavos', () => {
  it('acepta enteros no negativos', () => {
    expect(centavos(0)).toBe(0);
    expect(centavos(250)).toBe(250);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rechaza %p',
    (valor) => {
      expect(() => centavos(valor, 'precioBaseCentavos')).toThrow(ImporteInvalido);
    },
  );

  it('nombra el campo en el error', () => {
    expect(() => centavos(-5, 'precioBaseCentavos')).toThrow(/precioBaseCentavos/);
  });
});

describe('puntosBasicos', () => {
  it('acepta de 1 a 10000', () => {
    expect(puntosBasicos(1)).toBe(1);
    expect(puntosBasicos(10_000)).toBe(10_000);
  });

  it.each([0, 10_001, 12.5, -100])('rechaza %p', (valor) => {
    expect(() => puntosBasicos(valor)).toThrow(ImporteInvalido);
  });
});

describe('descuentoPorcentual (regla única: por unidad, mitad hacia arriba)', () => {
  it.each([
    // precio, puntos básicos, descuento esperado
    [250, 2000, 50], // 20 % de 2,50 = 0,50 exacto
    [199, 1000, 20], // 19,9 → 20
    [105, 1000, 11], // 10,5 → 11 (mitad hacia arriba)
    [104, 1000, 10], // 10,4 → 10
    [333, 3333, 111], // 110,9889 → 111
    [1, 5000, 1], // 0,5 → 1
    [1, 4999, 0], // 0,4999 → 0
    [0, 2000, 0],
    [999, 10_000, 999], // 100 %
  ])('%p centavos con %p pb → %p', (precio, pb, esperado) => {
    expect(descuentoPorcentual(precio, pb)).toBe(esperado);
  });

  it('nunca supera el precio', () => {
    for (let precio = 0; precio <= 300; precio += 1) {
      expect(descuentoPorcentual(precio, 10_000)).toBe(precio);
    }
  });

  it('rechaza entradas inválidas', () => {
    expect(() => descuentoPorcentual(-1, 2000)).toThrow(ImporteInvalido);
    expect(() => descuentoPorcentual(100, 0)).toThrow(ImporteInvalido);
  });

  it('rechaza importes cuyo cálculo dejaría de ser exacto', () => {
    expect(() => descuentoPorcentual(Number.MAX_SAFE_INTEGER, 2000)).toThrow(/demasiado grande/);
  });
});

describe('repartirProporcional', () => {
  it('reparte exactamente el total según los pesos', () => {
    expect(repartirProporcional(100, [200, 200])).toEqual([50, 50]);
    expect(repartirProporcional(90, [100, 200])).toEqual([30, 60]);
  });

  it('asigna los centavos sobrantes por orden de posición', () => {
    // 100 / 3 = 33,33… → 33 + 33 + 33 = 99; el centavo restante va al primero
    expect(repartirProporcional(100, [100, 100, 100])).toEqual([34, 33, 33]);
    expect(repartirProporcional(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it('la suma siempre coincide con el total', () => {
    const pesos = [137, 250, 99, 1, 412];
    for (let total = 0; total <= 899; total += 7) {
      const partes = repartirProporcional(total, pesos);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(total);
      partes.forEach((parte, i) => expect(parte).toBeLessThanOrEqual(pesos[i] ?? 0));
    }
  });

  it('rechaza un total mayor que la suma de pesos o pesos vacíos', () => {
    expect(() => repartirProporcional(10, [3, 4])).toThrow(ImporteInvalido);
    expect(() => repartirProporcional(0, [])).toThrow(ImporteInvalido);
  });

  it('rechaza importes cuyo reparto dejaría de ser exacto', () => {
    const grande = 2 ** 40;
    expect(() => repartirProporcional(grande, [grande, grande])).toThrow(/demasiado grande/);
  });
});
