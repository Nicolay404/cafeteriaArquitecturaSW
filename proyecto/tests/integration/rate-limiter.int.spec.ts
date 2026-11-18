import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { setTimeout as delay } from 'node:timers/promises';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import {
  LimiterUnavailableError,
  RateLimiter,
} from '../../apps/api/src/modules/identidad/rate-limiter.js';

// T008 — límites de intentos (FR-005, research D-08) con Redis real: ventana deslizante atómica,
// `Retry-After`, independencia entre claves y fallo CERRADO si Redis no responde.
const rule = { limit: 3, windowSeconds: 60 };

describe('T008 — limitador de intentos con Redis real', () => {
  let infrastructure: Infrastructure;
  let limiter: RateLimiter;
  let counter = 0;
  const key = () => `acceso:cuenta:${++counter}`;

  beforeAll(async () => {
    infrastructure = await startInfrastructure();
    limiter = new RateLimiter({
      redisUrl: infrastructure.redisUrl,
      prefix: 'cafeteria:test:limite',
    });
  });
  afterAll(async () => {
    await limiter?.close();
    await infrastructure?.stop();
  });

  test('permite hasta el límite y bloquea el siguiente con el tiempo de espera', async () => {
    const k = key();
    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await limiter.record(k, rule);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - attempt);
    }
    const blocked = await limiter.record(k, rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(55);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  test('un intento bloqueado no se anota: no alarga el bloqueo', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) await limiter.record(k, rule);
    const first = await limiter.record(k, rule);
    await delay(1100);
    const second = await limiter.record(k, rule);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(first.retryAfterSeconds);
  });

  test('status consulta sin anotar', async () => {
    const k = key();
    await limiter.record(k, rule);
    expect((await limiter.status(k, rule)).remaining).toBe(2);
    expect((await limiter.status(k, rule)).remaining).toBe(2);
  });

  test('cada clave tiene su propia cuenta', async () => {
    const a = key();
    const b = key();
    for (let i = 0; i < 3; i++) await limiter.record(a, rule);
    expect((await limiter.record(a, rule)).allowed).toBe(false);
    expect((await limiter.record(b, rule)).allowed).toBe(true);
  });

  test('la ventana se desliza: tras ella se puede volver a intentar', async () => {
    const k = key();
    const short = { limit: 2, windowSeconds: 1 };
    await limiter.record(k, short);
    await limiter.record(k, short);
    expect((await limiter.record(k, short)).allowed).toBe(false);
    await delay(1300);
    expect((await limiter.record(k, short)).allowed).toBe(true);
  });

  test('reset borra los intentos (acceso correcto)', async () => {
    const k = key();
    for (let i = 0; i < 3; i++) await limiter.record(k, rule);
    await limiter.reset(k);
    expect((await limiter.status(k, rule)).allowed).toBe(true);
  });

  test('es atómico: 25 intentos simultáneos con límite 5 permiten exactamente 5', async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => limiter.record(k, { limit: 5, windowSeconds: 60 })),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
  });

  test('las claves caducan solas en Redis (no quedan datos para siempre)', async () => {
    const k = key();
    await limiter.record(k, { limit: 1, windowSeconds: 1 });
    // La clave dura la ventana (1 s) más 1 s de margen.
    await delay(2400);
    expect(await limiter.exists(k)).toBe(false);
  });

  test('rechaza reglas inválidas sin tocar Redis', async () => {
    await expect(limiter.record(key(), { limit: 0, windowSeconds: 60 })).rejects.toThrow(/regla/i);
    await expect(limiter.record(key(), { limit: 3, windowSeconds: 0 })).rejects.toThrow(/regla/i);
    await expect(limiter.record('', rule)).rejects.toThrow(/clave/i);
  });

  test('con Redis sin respuesta falla CERRADO y se recupera al volver', async () => {
    const k = key();
    await infrastructure.pause('redis', true);
    try {
      await expect(limiter.record(k, rule)).rejects.toBeInstanceOf(LimiterUnavailableError);
      await expect(limiter.status(k, rule)).rejects.toBeInstanceOf(LimiterUnavailableError);
    } finally {
      await infrastructure.pause('redis', false);
    }
    expect((await limiter.record(k, rule)).allowed).toBe(true);
  });
});
