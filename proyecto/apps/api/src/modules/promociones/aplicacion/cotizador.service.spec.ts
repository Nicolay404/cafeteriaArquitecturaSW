import { describe, expect, it, jest } from '@jest/globals';
import { CotizadorPromociones, type FuentePromociones } from './cotizador.service.js';
import type { LineaACotizar, Promocion } from '../dominio/tipos.js';

const AHORA = new Date('2026-12-23T15:00:00.000Z');
const NAVIDAD_SIGUIENTE = new Date('2027-12-23T15:00:00.000Z');

const navidad: Promocion = {
  id: 'navidad',
  nombre: '20 % en bebidas calientes',
  valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
  alcance: { productoIds: [], categoriaIds: ['calientes'], menuIds: [] },
  inicio: new Date('2026-12-20T05:00:00.000Z'),
  fin: new Date('2026-12-26T05:00:00.000Z'),
  prioridad: 0,
  acumulable: false,
  usos: 0,
  estado: 'activa',
  version: 1,
};

const cafe: LineaACotizar = {
  productoId: 'cafe',
  categoriaIds: ['calientes'],
  menuId: 'desayuno',
  cantidad: 1,
  precioBaseCentavos: 250,
};

function crear(promociones: readonly Promocion[] = [navidad]) {
  const candidatas = jest.fn<FuentePromociones['candidatas']>(() => Promise.resolve(promociones));
  const cotizador = new CotizadorPromociones({ candidatas }, () => AHORA);
  return { cotizador, candidatas };
}

describe('CotizadorPromociones.cotizar', () => {
  it('usa el reloj del servidor cuando la solicitud no trae instante', async () => {
    const { cotizador, candidatas } = crear();
    const c = await cotizador.cotizar({ lineas: [cafe] });
    expect(candidatas).toHaveBeenCalledWith(AHORA);
    expect(c).toMatchObject({ instante: AHORA.toISOString(), totalCentavos: 200 });
  });

  it('FR-013: simula en un instante futuro sin aplicar promociones que ya no estarán vigentes', async () => {
    const { cotizador, candidatas } = crear();
    const c = await cotizador.cotizar({ lineas: [cafe], instante: NAVIDAD_SIGUIENTE });
    expect(candidatas).toHaveBeenCalledWith(NAVIDAD_SIGUIENTE);
    expect(c).toMatchObject({ instante: NAVIDAD_SIGUIENTE.toISOString(), totalCentavos: 250 });
  });

  it('pasa el cupón al motor', async () => {
    const conCupon = { ...navidad, cupon: { codigo: 'NAVIDAD' } };
    const { cotizador } = crear([conCupon]);
    expect((await cotizador.cotizar({ lineas: [cafe] })).totalCentavos).toBe(250);
    expect(
      (await cotizador.cotizar({ lineas: [cafe], codigoCupon: 'navidad' })).totalCentavos,
    ).toBe(200);
  });

  it('usa la hora real por defecto', async () => {
    const candidatas = jest.fn<FuentePromociones['candidatas']>(() => Promise.resolve([]));
    const antes = Date.now();
    const c = await new CotizadorPromociones({ candidatas }).cotizar({ lineas: [cafe] });
    expect(Date.parse(c.instante)).toBeGreaterThanOrEqual(antes);
  });

  it('propaga los fallos de la fuente sin inventar un precio', async () => {
    const candidatas = jest.fn<FuentePromociones['candidatas']>(() =>
      Promise.reject(new Error('base de datos caída')),
    );
    await expect(
      new CotizadorPromociones({ candidatas }, () => AHORA).cotizar({ lineas: [cafe] }),
    ).rejects.toThrow('base de datos caída');
  });
});
