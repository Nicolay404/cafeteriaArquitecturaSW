// Escenarios sintéticos de carga para medir el motor (T024). Solo datos de prueba: los usa
// motor-rendimiento.spec.ts y la medición registrada en evidence/rendimiento.md.

import type { LineaACotizar, Promocion, ValorPromocion } from './tipos.js';

const VALORES: readonly ValorPromocion[] = [
  { tipo: 'porcentaje', puntosBasicos: 500 },
  { tipo: 'monto_fijo', centavos: 10 },
  { tipo: 'nxm', lleva: 3, paga: 2 },
  {
    tipo: 'combo',
    productos: [
      { productoId: 'p00', cantidad: 1 },
      { productoId: 'p01', cantidad: 1 },
    ],
    precioCentavos: 300,
  },
];

/** 10 productos × 5 unidades = 50 unidades: el máximo por carrito del spec 004. */
export function carritoMaximo(): LineaACotizar[] {
  return Array.from({ length: 10 }, (_, i) => ({
    productoId: `p${String(i).padStart(2, '0')}`,
    categoriaIds: ['todas', `cat${String(i % 3)}`],
    menuId: 'menu',
    cantidad: 5,
    precioBaseCentavos: 200 + i * 25,
  }));
}

/**
 * `n` promociones vigentes que afectan a todas las unidades, de los cuatro tipos. Con
 * `mismaPrioridad` y todas acumulables es el peor caso del algoritmo: cada aplicación vuelve a
 * evaluar a todas las pendientes del nivel.
 */
export function promocionesSinteticas(n: number, mismaPrioridad: boolean): Promocion[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `promo-${String(i).padStart(4, '0')}`,
    nombre: `Promo ${String(i)}`,
    valor: VALORES[i % VALORES.length] as ValorPromocion,
    alcance: { productoIds: [], categoriaIds: ['todas'], menuIds: [] },
    inicio: new Date('2026-01-01T00:00:00Z'),
    fin: new Date('2099-01-01T00:00:00Z'),
    prioridad: mismaPrioridad ? 0 : i % 10,
    acumulable: true,
    usos: 0,
    estado: 'activa',
    version: 1,
  }));
}

export const INSTANTE_CARGA = new Date('2026-12-23T15:00:00Z');
