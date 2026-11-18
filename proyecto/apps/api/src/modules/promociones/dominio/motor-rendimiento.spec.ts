// T024 — guarda de regresión del rendimiento del motor (SC-005). El umbral es holgado a
// propósito (10 veces lo medido en el peor caso, ver evidence/rendimiento.md) para que no falle
// por la velocidad de la máquina de CI, pero sí si un cambio dispara la complejidad.
import { describe, expect, it } from '@jest/globals';
import { performance } from 'node:perf_hooks';
import { INSTANTE_CARGA, carritoMaximo, promocionesSinteticas } from './escenarios-carga.js';
import { calcularCotizacion } from './motor-precios.js';

function medianaMs(repeticiones: number, fn: () => void): number {
  const tiempos: number[] = [];
  for (let i = 0; i < repeticiones; i += 1) {
    const inicio = performance.now();
    fn();
    tiempos.push(performance.now() - inicio);
  }
  tiempos.sort((a, b) => a - b);
  return tiempos[Math.floor(tiempos.length / 2)] ?? Number.POSITIVE_INFINITY;
}

describe('rendimiento del motor (T024)', () => {
  const lineas = carritoMaximo();

  it('el carrito máximo tiene 50 unidades', () => {
    expect(lineas.reduce((s, l) => s + l.cantidad, 0)).toBe(50);
  });

  it.each([
    ['200 promociones en 10 prioridades', false],
    ['peor caso: 200 acumulables con la misma prioridad', true],
  ])('%s: mediana < 50 ms y resultado coherente', (_caso, mismaPrioridad) => {
    const promociones = promocionesSinteticas(200, mismaPrioridad);
    const c = calcularCotizacion({ lineas }, promociones, INSTANTE_CARGA);
    expect(c.totalCentavos).toBe(c.subtotalCentavos - c.descuentoCentavos);
    expect(c.totalCentavos).toBeGreaterThanOrEqual(0);
    expect(c.promocionesAplicadas.length).toBeGreaterThan(0);
    expect(
      medianaMs(15, () => calcularCotizacion({ lineas }, promociones, INSTANTE_CARGA)),
    ).toBeLessThan(50);
  });
});
