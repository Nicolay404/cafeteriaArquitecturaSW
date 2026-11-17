import { randomUUID } from 'node:crypto';
import { connect } from 'amqplib';
import { createClient } from 'redis';

interface ProbeConfig {
  rabbitmqUrl: string;
  redisUrl: string;
  version: string;
  appEnv: string;
}

async function bounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Sondeo técnico no disponible')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runPlatformProbe(config: ProbeConfig, instanceId: string) {
  const correlationId = randomUUID();
  const connection = await connect(config.rabbitmqUrl, { timeout: 1500 });
  connection.on('error', () => {});
  try {
    const channel = await bounded(connection.createConfirmChannel());
    try {
      const { queue } = await bounded(
        channel.assertQueue('', { exclusive: true, autoDelete: true }),
      );
      channel.sendToQueue(queue, Buffer.from(correlationId), { correlationId });
      await bounded(channel.waitForConfirms());
      const message = await bounded(channel.get(queue, { noAck: false }));
      if (
        !message ||
        message.properties.correlationId !== correlationId ||
        message.content.toString() !== correlationId
      ) {
        throw new Error('Correlación técnica inválida');
      }
      channel.ack(message);
      if (await bounded(channel.get(queue, { noAck: true })))
        throw new Error('Mensaje técnico duplicado');
    } finally {
      await bounded(channel.close());
    }
  } finally {
    await bounded(connection.close());
  }

  const key = `cafeteria:${config.appEnv}:worker:heartbeat:${instanceId}`;
  const value = { version: config.version, timestamp: new Date().toISOString() };
  const redis = createClient({
    url: config.redisUrl,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  try {
    await bounded(redis.connect());
    await bounded(redis.set(key, JSON.stringify(value), { EX: 30 }));
  } finally {
    if (redis.isOpen) redis.destroy();
  }
  return { key, value };
}

export async function removeSignal(redisUrl: string, key: string) {
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: 1000, reconnectStrategy: false },
  });
  redis.on('error', () => {});
  try {
    await bounded(redis.connect());
    await bounded(redis.del(key));
  } finally {
    if (redis.isOpen) redis.destroy();
  }
}

export async function startPlatformWorker(config: ProbeConfig, instanceId: string = randomUUID()) {
  let stopping = false;
  let key: string | undefined;
  let active: Promise<void> | undefined;
  const probe = () => {
    if (active || stopping) return active;
    active = runPlatformProbe(config, instanceId)
      .then((signal) => {
        key = signal.key;
        console.log(JSON.stringify({ event: 'worker_ready', ...signal.value, instanceId }));
      })
      .catch(() => {
        console.warn(JSON.stringify({ event: 'worker_unavailable', version: config.version }));
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  };
  await probe();
  const timer = setInterval(() => {
    void probe();
  }, 10_000);
  return {
    async stop() {
      stopping = true;
      clearInterval(timer);
      await active;
      if (key) await removeSignal(config.redisUrl, key);
    },
  };
}
