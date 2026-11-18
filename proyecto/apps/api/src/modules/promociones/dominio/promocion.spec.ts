import { describe, expect, it } from '@jest/globals';
import {
  TransicionNoPermitida,
  siguienteEstado,
  validarPromocion,
  type BorradorPromocion,
} from './promocion.js';

const base: BorradorPromocion = {
  nombre: '20 % en bebidas calientes',
  valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
  alcance: { productoIds: [], categoriaIds: ['bebidas-calientes'], menuIds: [] },
  inicio: new Date('2026-12-20T05:00:00Z'),
  fin: new Date('2026-12-26T05:00:00Z'),
};

function errores(borrador: BorradorPromocion): Record<string, string> {
  const r = validarPromocion(borrador);
  if (r.ok) throw new Error('se esperaba un error de validación');
  return Object.fromEntries(r.errores.map((e) => [e.campo, e.mensaje]));
}

describe('validarPromocion', () => {
  it('acepta una promoción válida y aplica los valores por defecto', () => {
    const r = validarPromocion({ ...base, nombre: '  20 % en bebidas calientes  ' });
    expect(r).toEqual({
      ok: true,
      valor: {
        nombre: '20 % en bebidas calientes',
        valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
        alcance: base.alcance,
        inicio: base.inicio,
        fin: base.fin,
        prioridad: 0,
        acumulable: false,
      },
    });
  });

  it('conserva los campos opcionales válidos y normaliza el cupón', () => {
    const r = validarPromocion({
      ...base,
      etiquetaFestividad: ' Navidad ',
      prioridad: 10,
      acumulable: true,
      montoMinimoCentavos: 1000,
      cupon: { codigo: ' navidad 2026 ', limiteUsos: 100 },
    });
    expect(r.ok && r.valor).toMatchObject({
      etiquetaFestividad: 'Navidad',
      prioridad: 10,
      acumulable: true,
      montoMinimoCentavos: 1000,
      cupon: { codigo: 'NAVIDAD2026', limiteUsos: 100 },
    });
  });

  it('US1.4: fin anterior o igual al inicio se rechaza explicando cómo corregirlo', () => {
    expect(errores({ ...base, fin: base.inicio }).fin).toMatch(/posterior al inicio/);
    expect(errores({ ...base, fin: new Date('2026-12-01T00:00Z') }).fin).toMatch(/posterior/);
  });

  it('US1.4: sin alcance se rechaza', () => {
    const alcance = { productoIds: [], categoriaIds: [], menuIds: [] };
    expect(errores({ ...base, alcance }).alcance).toMatch(/al menos un producto, categoría o menú/);
  });

  it('rechaza identificadores vacíos en el alcance', () => {
    const alcance = { productoIds: [' '], categoriaIds: [], menuIds: [] };
    expect(errores({ ...base, alcance }).alcance).toMatch(/vacío/);
  });

  it('acumula todos los errores en una sola respuesta', () => {
    const r = validarPromocion({
      ...base,
      nombre: 'x',
      fin: base.inicio,
      prioridad: -1,
      montoMinimoCentavos: -5,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.map((e) => e.campo).sort()).toEqual(
        ['fin', 'montoMinimoCentavos', 'nombre', 'prioridad'].sort(),
      );
    }
  });

  it.each([
    ['nombre corto', { nombre: 'ab' }, 'nombre'],
    ['nombre largo', { nombre: 'x'.repeat(81) }, 'nombre'],
    ['fecha inválida', { inicio: new Date('no es fecha') }, 'inicio'],
    ['fin inválido', { fin: new Date(Number.NaN) }, 'fin'],
    ['etiqueta larga', { etiquetaFestividad: 'x'.repeat(41) }, 'etiquetaFestividad'],
    ['prioridad decimal', { prioridad: 1.5 }, 'prioridad'],
    ['prioridad excesiva', { prioridad: 1001 }, 'prioridad'],
    ['monto mínimo decimal', { montoMinimoCentavos: 10.5 }, 'montoMinimoCentavos'],
    ['cupón corto', { cupon: { codigo: 'AB' } }, 'cupon.codigo'],
    ['cupón con símbolos', { cupon: { codigo: 'HOLA$$' } }, 'cupon.codigo'],
    ['límite de usos 0', { cupon: { codigo: 'NAVIDAD', limiteUsos: 0 } }, 'cupon.limiteUsos'],
  ] as const)('rechaza %s', (_caso, cambio, campo) => {
    expect(errores({ ...base, ...cambio })[campo]).toBeDefined();
  });

  it('una etiqueta en blanco se omite', () => {
    const r = validarPromocion({ ...base, etiquetaFestividad: '   ' });
    expect(r.ok && 'etiquetaFestividad' in r.valor).toBe(false);
  });

  describe('valores por tipo', () => {
    it.each([
      [{ tipo: 'porcentaje', puntosBasicos: 0 }],
      [{ tipo: 'porcentaje', puntosBasicos: 10_001 }],
      [{ tipo: 'monto_fijo', centavos: 0 }],
      [{ tipo: 'monto_fijo', centavos: 1.5 }],
      [{ tipo: 'nxm', lleva: 1, paga: 1 }],
      [{ tipo: 'nxm', lleva: 2, paga: 2 }],
      [{ tipo: 'nxm', lleva: 3, paga: 0 }],
      [{ tipo: 'nxm', lleva: 2.5, paga: 1 }],
    ] as const)('rechaza %j', (valor) => {
      expect(errores({ ...base, valor }).valor).toBeDefined();
    });

    it.each([
      [{ tipo: 'porcentaje', puntosBasicos: 10_000 }],
      [{ tipo: 'monto_fijo', centavos: 50 }],
      [{ tipo: 'nxm', lleva: 2, paga: 1 }],
      [{ tipo: 'nxm', lleva: 3, paga: 2 }],
    ] as const)('acepta %j', (valor) => {
      expect(validarPromocion({ ...base, valor }).ok).toBe(true);
    });
  });

  describe('combo', () => {
    const combo: BorradorPromocion = {
      ...base,
      nombre: 'Café + sánduche',
      valor: {
        tipo: 'combo',
        productos: [
          { productoId: 'cafe', cantidad: 1 },
          { productoId: 'sanduche', cantidad: 1 },
        ],
        precioCentavos: 350,
      },
      alcance: { productoIds: [], categoriaIds: [], menuIds: [] },
    };

    it('no necesita alcance: su alcance son sus productos', () => {
      expect(validarPromocion(combo).ok).toBe(true);
    });

    it('acepta un solo producto con cantidad ≥ 2', () => {
      const valor = {
        tipo: 'combo',
        productos: [{ productoId: 'cafe', cantidad: 2 }],
        precioCentavos: 300,
      } as const;
      expect(validarPromocion({ ...combo, valor }).ok).toBe(true);
    });

    it.each([
      ['sin productos', { productos: [], precioCentavos: 100 }],
      [
        'una sola unidad',
        { productos: [{ productoId: 'cafe', cantidad: 1 }], precioCentavos: 100 },
      ],
      [
        'cantidad 0',
        {
          productos: [
            { productoId: 'cafe', cantidad: 0 },
            { productoId: 'pan', cantidad: 1 },
          ],
          precioCentavos: 100,
        },
      ],
      [
        'producto repetido',
        {
          productos: [
            { productoId: 'cafe', cantidad: 1 },
            { productoId: 'cafe', cantidad: 1 },
          ],
          precioCentavos: 100,
        },
      ],
      [
        'producto vacío',
        {
          productos: [
            { productoId: ' ', cantidad: 1 },
            { productoId: 'pan', cantidad: 1 },
          ],
          precioCentavos: 100,
        },
      ],
      ['precio negativo', { productos: [{ productoId: 'cafe', cantidad: 2 }], precioCentavos: -1 }],
    ] as const)('rechaza %s', (_caso, datos) => {
      expect(errores({ ...combo, valor: { tipo: 'combo', ...datos } }).valor).toBeDefined();
    });
  });
});

describe('siguienteEstado (FR-001)', () => {
  it.each([
    ['activa', 'pausar', 'pausada'],
    ['pausada', 'reanudar', 'activa'],
    ['activa', 'archivar', 'archivada'],
    ['pausada', 'archivar', 'archivada'],
  ] as const)('%s + %s → %s', (actual, accion, esperado) => {
    expect(siguienteEstado(actual, accion)).toBe(esperado);
  });

  it.each([
    ['activa', 'reanudar'],
    ['pausada', 'pausar'],
    ['archivada', 'reanudar'],
    ['archivada', 'pausar'],
    ['archivada', 'archivar'],
  ] as const)('%s + %s no está permitido', (actual, accion) => {
    expect(() => siguienteEstado(actual, accion)).toThrow(TransicionNoPermitida);
  });
});
