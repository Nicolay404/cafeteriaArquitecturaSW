import 'reflect-metadata';
import { afterEach, describe, expect, it } from '@jest/globals';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

let app: INestApplication | undefined;

async function start(available: boolean) {
  const calls = { ready: 0 };
  const fake = {
    version: '1.2.3-unit',
    async ready() {
      calls.ready += 1;
      return available;
    },
  };
  @Module({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: fake }],
  })
  class UnitModule {}
  app = await NestFactory.create(UnitModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  return { calls, url: await app.getUrl() };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('HealthController (HTTP real, dependencias simuladas)', () => {
  it('readiness responde 200 con estado, versión y no-store cuando todo está disponible', async () => {
    const { url } = await start(true);
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3-unit' });
  });

  it('readiness responde 503 con el mismo contrato cuando falta una dependencia', async () => {
    const { url } = await start(false);
    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', version: '1.2.3-unit' });
  });

  it('liveness no consulta dependencias y sigue en 200 aunque readiness falle', async () => {
    const { calls, url } = await start(false);
    const response = await fetch(`${url}/health/live`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ok', version: '1.2.3-unit' });
    expect(calls.ready).toBe(0);
  });
});
