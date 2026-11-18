import { afterAll, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { createClient } from 'redis';
import { setTimeout as delay } from 'node:timers/promises';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import {
  CotizadorPromociones,
  DemasiadosIntentosCupon,
} from '../../apps/api/src/modules/promociones/aplicacion/cotizador.service.js';
import {
  LIMITE_CUPONES,
  LimitadorIntentosRedis,
} from '../../apps/api/src/modules/promociones/infraestructura/limitador-intentos.redis.js';

// T019 — FR-012 / US4.4: límite de intentos fallidos de cupón con Redis real.
const prefijo = 'cafeteria:test:promociones';
const cafe = {
  productoId: 'cafe',
  categoriaIds: ['calientes'],
  menuId: 'desayuno',
  cantidad: 1,
  precioBaseCentavos: 250,
};

describe('T019 — límite de intentos de cupón con Redis real', () => {
  let infrastructure: Infrastructure;
  let redis: ReturnType<typeof createClient>;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    redis = createClient({ url: infrastructure.redisUrl });
    await redis.connect();
  });
  beforeEach(async () => {
    await redis.flushDb();
  });
  afterAll(async () => {
    try {
      redis?.destroy();
    } finally {
      await infrastructure?.stop();
    }
  });

  const limitador = (ventanaMs: number = LIMITE_CUPONES.ventanaMs) =>
    new LimitadorIntentosRedis(redis, { prefijo, maxFallos: LIMITE_CUPONES.maxFallos, ventanaMs });

  test('bloquea al llegar a 10 fallos, no antes', async () => {
    const l = limitador();
    for (let i = 0; i < 9; i += 1) await l.registrarFallo('cliente-1');
    expect(await l.estaBloqueado('cliente-1')).toBe(false);
    await l.registrarFallo('cliente-1');
    expect(await l.estaBloqueado('cliente-1')).toBe(true);
  });

  test('cada sujeto tiene su propio contador', async () => {
    const l = limitador();
    for (let i = 0; i < 10; i += 1) await l.registrarFallo('cliente-1');
    expect(await l.estaBloqueado('cliente-2')).toBe(false);
  });

  test('los fallos caducan al salir de la ventana deslizante', async () => {
    const l = limitador(1_000);
    for (let i = 0; i < 10; i += 1) await l.registrarFallo('cliente-1');
    expect(await l.estaBloqueado('cliente-1')).toBe(true);
    await delay(1_200);
    expect(await l.estaBloqueado('cliente-1')).toBe(false);
  });

  test('la clave no guarda al sujeto en claro y caduca sola', async () => {
    const l = limitador();
    await l.registrarFallo('203.0.113.7');
    const claves = await redis.keys(`${prefijo}:*`);
    expect(claves).toEqual([l.clave('203.0.113.7')]);
    expect(claves[0]).not.toContain('203.0.113.7');
    const ttl = await redis.pTTL(l.clave('203.0.113.7'));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(LIMITE_CUPONES.ventanaMs);
  });

  test('US4.4: tras 10 códigos no válidos el undécimo intento se frena, aunque sea válido', async () => {
    const promocion = {
      id: 'navidad',
      nombre: 'Navidad',
      valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
      alcance: { productoIds: [], categoriaIds: ['calientes'], menuIds: [] },
      inicio: new Date('2026-01-01T00:00:00Z'),
      fin: new Date('2099-01-01T00:00:00Z'),
      prioridad: 0,
      acumulable: false,
      usos: 0,
      estado: 'activa',
      version: 1,
      cupon: { codigo: 'NAVIDAD' },
    } as const;
    const cotizador = new CotizadorPromociones(
      { candidatas: () => Promise.resolve([promocion]) },
      { limitador: limitador() },
    );
    const intentar = (codigoCupon: string) =>
      cotizador.cotizar({ lineas: [cafe], codigoCupon, sujeto: 'cliente-1' });

    for (let i = 0; i < 10; i += 1)
      expect((await intentar(`FALSO${String(i)}`)).cupon).toEqual({ estado: 'no_valido' });
    await expect(intentar('NAVIDAD')).rejects.toThrow(DemasiadosIntentosCupon);
    const otro = await cotizador.cotizar({
      lineas: [cafe],
      codigoCupon: 'NAVIDAD',
      sujeto: 'cliente-2',
    });
    expect(otro.cupon).toEqual({ estado: 'aplicado', promocionId: 'navidad' });
  });
});
