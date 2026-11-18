import { describe, expect, it, jest } from '@jest/globals';
import {
  CotizadorPromociones,
  DemasiadosIntentosCupon,
  type FuentePromociones,
  type LimitadorIntentos,
} from './cotizador.service.js';
import { SolicitudInvalida } from '../dominio/motor-precios.js';
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
const conCupon: Promocion = { ...navidad, cupon: { codigo: 'NAVIDAD' } };

const cafe: LineaACotizar = {
  productoId: 'cafe',
  categoriaIds: ['calientes'],
  menuId: 'desayuno',
  cantidad: 1,
  precioBaseCentavos: 250,
};

function limitadorFalso(bloqueado = false) {
  return {
    estaBloqueado: jest.fn<LimitadorIntentos['estaBloqueado']>(() => Promise.resolve(bloqueado)),
    registrarFallo: jest.fn<LimitadorIntentos['registrarFallo']>(() => Promise.resolve()),
  };
}

function crear(promociones: readonly Promocion[] = [navidad], limitador = limitadorFalso()) {
  const candidatas = jest.fn<FuentePromociones['candidatas']>(() => Promise.resolve(promociones));
  const cotizador = new CotizadorPromociones({ candidatas }, { limitador, reloj: () => AHORA });
  return { cotizador, candidatas, limitador };
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
    const { cotizador } = crear([conCupon]);
    expect((await cotizador.cotizar({ lineas: [cafe] })).totalCentavos).toBe(250);
    const c = await cotizador.cotizar({ lineas: [cafe], codigoCupon: 'navidad', sujeto: 'c-1' });
    expect(c.totalCentavos).toBe(200);
  });

  it('usa la hora real por defecto', async () => {
    const candidatas = jest.fn<FuentePromociones['candidatas']>(() => Promise.resolve([]));
    const antes = Date.now();
    const cotizador = new CotizadorPromociones({ candidatas }, { limitador: limitadorFalso() });
    const c = await cotizador.cotizar({ lineas: [cafe] });
    expect(Date.parse(c.instante)).toBeGreaterThanOrEqual(antes);
  });

  it('propaga los fallos de la fuente sin inventar un precio', async () => {
    const candidatas = jest.fn<FuentePromociones['candidatas']>(() =>
      Promise.reject(new Error('base de datos caída')),
    );
    const cotizador = new CotizadorPromociones({ candidatas }, { limitador: limitadorFalso() });
    await expect(cotizador.cotizar({ lineas: [cafe] })).rejects.toThrow('base de datos caída');
  });
});

describe('CotizadorPromociones — límite de intentos de cupón (T019, FR-012, US4.4)', () => {
  it('sin cupón no consulta el limitador', async () => {
    const { cotizador, limitador } = crear();
    await cotizador.cotizar({ lineas: [cafe] });
    expect(limitador.estaBloqueado).not.toHaveBeenCalled();
    expect(limitador.registrarFallo).not.toHaveBeenCalled();
  });

  it('un cupón exige un sujeto al que limitar', async () => {
    const { cotizador } = crear([conCupon]);
    await expect(cotizador.cotizar({ lineas: [cafe], codigoCupon: 'NAVIDAD' })).rejects.toThrow(
      SolicitudInvalida,
    );
    await expect(
      cotizador.cotizar({ lineas: [cafe], codigoCupon: 'NAVIDAD', sujeto: '  ' }),
    ).rejects.toThrow(SolicitudInvalida);
  });

  it('registra un fallo solo cuando el código no es válido', async () => {
    const { cotizador, limitador } = crear([conCupon]);
    await cotizador.cotizar({ lineas: [cafe], codigoCupon: 'ADIVINA', sujeto: 'c-1' });
    expect(limitador.registrarFallo).toHaveBeenCalledWith('c-1');
    limitador.registrarFallo.mockClear();
    await cotizador.cotizar({ lineas: [cafe], codigoCupon: 'NAVIDAD', sujeto: 'c-1' });
    const agotado = { ...conCupon, cupon: { codigo: 'NAVIDAD', limiteUsos: 1 }, usos: 1 };
    await crear([agotado], limitador).cotizador.cotizar({
      lineas: [cafe],
      codigoCupon: 'NAVIDAD',
      sujeto: 'c-1',
    });
    expect(limitador.registrarFallo).not.toHaveBeenCalled();
  });

  it('un sujeto bloqueado recibe un error que dice cuándo reintentar, sin evaluar el código', async () => {
    const { cotizador, limitador, candidatas } = crear([conCupon], limitadorFalso(true));
    const intento = cotizador.cotizar({ lineas: [cafe], codigoCupon: 'NAVIDAD', sujeto: 'c-1' });
    await expect(intento).rejects.toThrow(DemasiadosIntentosCupon);
    await expect(intento).rejects.toThrow(/15 minutos/);
    expect(candidatas).not.toHaveBeenCalled();
    expect(limitador.registrarFallo).not.toHaveBeenCalled();
  });

  it('si el limitador falla, la cotización sigue (falla abierta, R6)', async () => {
    const roto: LimitadorIntentos = {
      estaBloqueado: () => Promise.reject(new Error('redis caído')),
      registrarFallo: () => Promise.reject(new Error('redis caído')),
    };
    const { cotizador } = crear([conCupon], roto as ReturnType<typeof limitadorFalso>);
    const valido = await cotizador.cotizar({
      lineas: [cafe],
      codigoCupon: 'NAVIDAD',
      sujeto: 'c-1',
    });
    expect(valido.totalCentavos).toBe(200);
    const invalido = await cotizador.cotizar({ lineas: [cafe], codigoCupon: 'XX', sujeto: 'c-1' });
    expect(invalido.cupon).toEqual({ estado: 'no_valido' });
  });
});
