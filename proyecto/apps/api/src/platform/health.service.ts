import { Client } from 'pg';
import { createClient } from 'redis';
import { connect } from 'amqplib';

export interface HealthConfig {
  version: string;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
}

async function bounded<T>(operation: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dependencia no disponible')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class HealthService {
  constructor(private readonly config: HealthConfig) {}

  get version() {
    return this.config.version;
  }

  async ready(): Promise<boolean> {
    // Parallel probes; each owns and closes its short-lived connection.
    // No tables, keys, queues or durable messages are written by readiness.
    const results = await Promise.allSettled([this.postgres(), this.redis(), this.rabbitmq()]);
    const dependencies = ['postgres', 'redis', 'rabbitmq'];
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        // Never log driver errors: they can embed hosts, URLs or credentials.
        console.warn(
          JSON.stringify({
            event: 'health_dependency_unavailable',
            dependency: dependencies[index],
          }),
        );
      }
    });
    return results.every((result) => result.status === 'fulfilled');
  }

  private async postgres() {
    const client = new Client({
      connectionString: this.config.databaseUrl,
      connectionTimeoutMillis: 800,
      query_timeout: 800,
    });
    client.on('error', () => {});
    try {
      await client.connect();
      await client.query('SELECT 1');
    } finally {
      await client.end();
    }
  }

  private async redis() {
    const client = createClient({
      url: this.config.redisUrl,
      socket: { connectTimeout: 800, reconnectStrategy: false },
    });
    client.on('error', () => {});
    try {
      await bounded(
        client.connect().then(() => client.ping()),
        1600,
      );
    } finally {
      if (client.isOpen) client.destroy();
    }
  }

  private async rabbitmq() {
    const connection = await connect(this.config.rabbitmqUrl, { timeout: 1600 });
    connection.on('error', () => {});
    await bounded(connection.close(), 300);
  }
}
