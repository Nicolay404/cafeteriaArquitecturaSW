import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'amqplib';
import { Client } from 'pg';
import { createClient } from 'redis';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { startPlatformWorker } from '../../apps/worker/src/platform-probe.js';

// T017 — persistencia técnica tras reinicio y recuperación del worker. Solo contenedores
// aislados de prueba (puertos dinámicos); sin tablas, colas ni datos de negocio.
describe('T017 — persistencia y recuperación con infraestructura real', () => {
  let infrastructure: Infrastructure;
  beforeAll(async () => {
    infrastructure = await startInfrastructure();
  });
  afterAll(async () => {
    await infrastructure?.stop();
  });

  test('Postgres conserva una fila técnica tras reiniciar el contenedor', async () => {
    const table = `t017_${randomUUID().replaceAll('-', '')}`;
    const marker = randomUUID();
    const write = new Client({ connectionString: infrastructure.databaseUrl });
    await write.connect();
    try {
      await write.query(`CREATE TABLE ${table} (marker text PRIMARY KEY)`);
      await write.query(`INSERT INTO ${table} (marker) VALUES ($1)`, [marker]);
    } finally {
      await write.end();
    }

    await infrastructure.containers.postgres.restart({ timeout: 20_000 });

    // El puerto publicado puede cambiar al reiniciar: databaseUrl se recalcula.
    const read = new Client({ connectionString: infrastructure.databaseUrl });
    await read.connect();
    try {
      const result = await read.query(`SELECT marker FROM ${table}`);
      expect(result.rows).toEqual([{ marker }]);
      await read.query(`DROP TABLE ${table}`);
    } finally {
      await read.end();
    }
  });

  test('RabbitMQ conserva un mensaje persistente de una cola durable tras reiniciar', async () => {
    const queue = `t017.${randomUUID()}`;
    const payload = randomUUID();
    const publisher = await connect(infrastructure.rabbitmqUrl);
    try {
      const channel = await publisher.createConfirmChannel();
      await channel.assertQueue(queue, { durable: true });
      channel.sendToQueue(queue, Buffer.from(payload), { persistent: true });
      await channel.waitForConfirms();
      await channel.close();
    } finally {
      await publisher.close();
    }

    await infrastructure.containers.rabbitmq.restart({ timeout: 30_000 });

    const consumer = await connect(infrastructure.rabbitmqUrl);
    try {
      const channel = await consumer.createChannel();
      const message = await channel.get(queue, { noAck: false });
      expect(message && message.content.toString()).toBe(payload);
      if (message) channel.ack(message);
      expect(await channel.get(queue, { noAck: true })).toBe(false);
      await channel.deleteQueue(queue);
      await channel.close();
    } finally {
      await consumer.close();
    }
  });

  test('el worker sigue vivo con RabbitMQ caído y restablece su señal al volver', async () => {
    const instanceId = `t017-${randomUUID()}`;
    const key = `cafeteria:local:worker:heartbeat:${instanceId}`;
    const worker = await startPlatformWorker(
      {
        redisUrl: infrastructure.redisUrl,
        rabbitmqUrl: infrastructure.rabbitmqUrl,
        version: 't017',
        appEnv: 'local',
      },
      instanceId,
    );
    const redis = createClient({ url: infrastructure.redisUrl });
    await redis.connect();
    try {
      expect(await redis.get(key)).not.toBeNull();

      // Con el broker sin respuesta no hay señal nueva, pero el worker no termina ni lanza.
      await infrastructure.pause('rabbitmq', true);
      try {
        await redis.del(key);
        await delay(12_000);
        expect(await redis.get(key)).toBeNull();
      } finally {
        await infrastructure.pause('rabbitmq', false);
      }

      // Al volver el broker, el siguiente sondeo periódico recrea la señal sin reiniciar.
      const deadline = Date.now() + 30_000;
      let recovered: string | null = null;
      while (Date.now() < deadline && recovered === null) {
        await delay(500);
        recovered = await redis.get(key);
      }
      expect(recovered).not.toBeNull();
      expect(JSON.parse(recovered!)).toMatchObject({ version: 't017' });
    } finally {
      await worker.stop();
      expect(await redis.get(key)).toBeNull();
      if (redis.isOpen) redis.destroy();
    }
  });
});
