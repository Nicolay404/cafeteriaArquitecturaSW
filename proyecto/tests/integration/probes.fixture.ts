import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from 'pg';
import { createClient } from 'redis';
import { connect } from 'amqplib';

export async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Tiempo de prueba agotado')), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function postgresProbe(url: string) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 1000,
    query_timeout: 1000,
  });
  client.on('error', () => {});
  try {
    await client.connect();
    const result = await client.query<{ value: number }>('SELECT $1::int AS value', [1]);
    return result.rows[0]?.value;
  } finally {
    await client.end();
  }
}

export async function redisProbe(url: string) {
  const client = createClient({ url, socket: { connectTimeout: 1000, reconnectStrategy: false } });
  client.on('error', () => {});
  const key = `platform-test:${randomUUID()}`;
  try {
    await within(client.connect(), 1500);
    await within(client.set(key, 'technical', { EX: 30 }), 1500);
    const value = await within(client.get(key), 1500);
    const deletedCount = await within(client.del(key), 1500);
    const afterDelete = await within(client.get(key), 1500);
    return { value, deletedCount, afterDelete };
  } finally {
    if (client.isOpen) client.destroy();
  }
}

export async function rabbitmqProbe(url: string) {
  const connection = await connect(url, { timeout: 1500 });
  connection.on('error', () => {});
  try {
    const channel = await connection.createConfirmChannel();
    try {
      const { queue } = await channel.assertQueue('', { exclusive: true, autoDelete: true });
      const correlationId = randomUUID();
      const payload = Buffer.from('technical-platform-test');
      channel.sendToQueue(queue, payload, { correlationId });
      await channel.waitForConfirms();
      let result;
      const deadline = Date.now() + 3000;
      do {
        result = await channel.get(queue, { noAck: false });
        if (!result) await delay(25);
      } while (!result && Date.now() < deadline);
      if (!result) throw new Error('No llegó el mensaje técnico');
      const received = {
        correlationId: result.properties.correlationId,
        payload: result.content.toString(),
      };
      channel.ack(result);
      const empty = await channel.get(queue, { noAck: true });
      return { sentCorrelationId: correlationId, received, empty };
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}
