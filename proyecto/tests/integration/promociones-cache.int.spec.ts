import { afterAll, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createClient } from 'redis';
import { setTimeout as delay } from 'node:timers/promises';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { CacheVigentes } from '../../apps/api/src/modules/promociones/infraestructura/cache-vigentes.js';
import type { FuentePromociones } from '../../apps/api/src/modules/promociones/aplicacion/cotizador.service.js';
import type { Promocion } from '../../apps/api/src/modules/promociones/dominio/tipos.js';

// T021 — R8: caché Redis de promociones vigentes, con invalidación y falla segura.
const prefijo = 'cafeteria:test:promociones';
const T0 = new Date('2026-12-23T15:00:00.000Z');
const despues = (ms: number) => new Date(T0.getTime() + ms);

const navidad: Promocion = {
  id: 'navidad',
  nombre: 'Navidad',
  valor: { tipo: 'porcentaje', puntosBasicos: 2000 },
  alcance: { productoIds: [], categoriaIds: ['calientes'], menuIds: [] },
  inicio: new Date('2026-12-20T05:00:00.000Z'),
  fin: new Date('2026-12-26T05:00:00.000Z'),
  etiquetaFestividad: 'Navidad',
  prioridad: 0,
  acumulable: false,
  montoMinimoCentavos: 500,
  cupon: { codigo: 'NAVIDAD', limiteUsos: 10 },
  usos: 2,
  estado: 'activa',
  version: 3,
};

describe('T021 — caché de promociones vigentes con Redis real', () => {
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

  function fuente(promociones: readonly Promocion[] = [navidad]) {
    return {
      candidatas: jest.fn<FuentePromociones['candidatas']>(() => Promise.resolve(promociones)),
    };
  }

  test('la segunda lectura sale de la caché con los mismos datos (fechas incluidas)', async () => {
    const origen = fuente();
    const cache = new CacheVigentes(origen, redis, { prefijo });
    const primera = await cache.candidatas(T0);
    const segunda = await cache.candidatas(despues(1_000));
    expect(origen.candidatas).toHaveBeenCalledTimes(1);
    expect(segunda).toEqual(primera);
    expect(segunda[0]?.inicio).toBeInstanceOf(Date);
    expect(segunda).toEqual([navidad]);
  });

  test('otra instancia de la API comparte la misma caché', async () => {
    const origen = fuente();
    await new CacheVigentes(origen, redis, { prefijo }).candidatas(T0);
    await new CacheVigentes(origen, redis, { prefijo }).candidatas(T0);
    expect(origen.candidatas).toHaveBeenCalledTimes(1);
  });

  test('invalidar obliga a releer la fuente', async () => {
    const origen = fuente();
    const cache = new CacheVigentes(origen, redis, { prefijo });
    await cache.candidatas(T0);
    await cache.invalidar();
    await cache.candidatas(T0);
    expect(origen.candidatas).toHaveBeenCalledTimes(2);
  });

  test('un instante anterior al de la caché consulta la fuente (simulación en el pasado)', async () => {
    const origen = fuente();
    const cache = new CacheVigentes(origen, redis, { prefijo });
    await cache.candidatas(T0);
    await cache.candidatas(new Date('2026-12-01T00:00:00.000Z'));
    expect(origen.candidatas).toHaveBeenCalledTimes(2);
  });

  test('la caché caduca tras su TTL', async () => {
    const origen = fuente();
    const cache = new CacheVigentes(origen, redis, { prefijo, ttlMs: 500 });
    await cache.candidatas(T0);
    await delay(700);
    await cache.candidatas(T0);
    expect(origen.candidatas).toHaveBeenCalledTimes(2);
  });

  test('una lectura lenta no deja datos viejos tras una invalidación', async () => {
    let liberar: (p: readonly Promocion[]) => void = () => undefined;
    const lenta: FuentePromociones = {
      candidatas: () =>
        new Promise((resolve) => {
          liberar = resolve;
        }),
    };
    const cache = new CacheVigentes(lenta, redis, { prefijo });
    const enCurso = cache.candidatas(T0);
    await delay(50);
    await cache.invalidar();
    liberar([navidad]); // dato anterior al cambio del administrador
    await enCurso;

    const pausada = { ...navidad, estado: 'pausada' as const, version: 4 };
    const origen = fuente([pausada]);
    const nueva = new CacheVigentes(origen, redis, { prefijo });
    expect(await nueva.candidatas(T0)).toEqual([pausada]);
    expect(origen.candidatas).toHaveBeenCalledTimes(1);
  });

  test('con Redis caído usa la fuente directamente', async () => {
    const caido: ReturnType<typeof createClient> = createClient({ url: infrastructure.redisUrl });
    await caido.connect();
    caido.destroy();
    const origen = fuente();
    const cache = new CacheVigentes(origen, caido, { prefijo });
    expect(await cache.candidatas(T0)).toEqual([navidad]);
    await expect(cache.invalidar()).resolves.toBeUndefined();
    expect(origen.candidatas).toHaveBeenCalledTimes(1);
  });
});
