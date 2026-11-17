import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Dependency, Infrastructure } from './infrastructure.fixture.js';
import { postgresProbe, rabbitmqProbe, redisProbe } from './probes.fixture.js';

describe('T010 — infraestructura real aislada', () => {
  let infrastructure: Infrastructure | undefined;
  beforeAll(async () => {
    infrastructure = await startInfrastructure();
  });
  afterAll(async () => {
    await infrastructure?.stop();
  });

  test('Postgres ejecuta SQL parametrizado sin tablas de negocio', async () => {
    expect(await postgresProbe(infrastructure!.databaseUrl)).toBe(1);
  });

  test('Redis escribe, lee y elimina una clave técnica única', async () => {
    expect(await redisProbe(infrastructure!.redisUrl)).toEqual({
      value: 'technical',
      deletedCount: 1,
      afterDelete: null,
    });
  });

  test('RabbitMQ confirma publicación, correlación, consumo y ack en cola exclusiva', async () => {
    const result = await rabbitmqProbe(infrastructure!.rabbitmqUrl);
    expect(result.received).toEqual({
      correlationId: result.sentCorrelationId,
      payload: 'technical-platform-test',
    });
    expect(result.empty).toBe(false);
  });

  test.each<Dependency>(['postgres', 'redis', 'rabbitmq'])(
    '%s deja de responder y recupera conectividad',
    async (dependency) => {
      const current = infrastructure!;
      const probe = {
        postgres: () => postgresProbe(current.databaseUrl),
        redis: () => redisProbe(current.redisUrl),
        rabbitmq: () => rabbitmqProbe(current.rabbitmqUrl),
      }[dependency];
      await current.pause(dependency, true);
      try {
        await expect(probe()).rejects.toThrow();
      } finally {
        await current.pause(dependency, false);
      }
      await expect(probe()).resolves.toBeDefined();
      // Restart the same isolated container and reconnect using its dynamic endpoint.
      await current.containers[dependency].restart({ timeout: 10_000 });
      await expect(probe()).resolves.toBeDefined();
    },
  );
});
