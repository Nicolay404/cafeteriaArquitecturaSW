import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { GenericContainer, Wait } from 'testcontainers';
import type { StartedTestContainer } from 'testcontainers';

const execute = promisify(execFile);
// Same immutable images as T007; these containers never use Compose volumes/ports.
const images = {
  postgres:
    'postgres:17.12-bookworm@sha256:40865bc877a289da75963d97d72b59633f639fc5af7a4e856bfa3714cae5b536',
  redis:
    'redis:8.8.4-alpine@sha256:1273af45b299d2b8b60d0e400d90aa6c2c5b1794f01d6a7ca60ff3ba6e65efb5',
  rabbitmq:
    'rabbitmq:4.4.0-management-alpine@sha256:4841f6384ef8313c3594cd3f2e9f40c10805f8a61c45f08a9a5d9ddea8199267',
};

export type Dependency = keyof typeof images;

export async function startInfrastructure() {
  const containers = {} as Record<Dependency, StartedTestContainer>;
  const password = randomUUID();
  const username = 'integration';
  const database = 'platform_test';
  const vhost = 'platform_test';
  const paused = new Set<Dependency>();

  async function pause(dependency: Dependency, value: boolean) {
    // IDs only come from this fixture, never from user input or Compose.
    await execute('docker', [value ? 'pause' : 'unpause', containers[dependency].getId()], {
      timeout: 10_000,
    });
    if (value) paused.add(dependency);
    else paused.delete(dependency);
  }

  async function stop() {
    const errors: unknown[] = [];
    for (const dependency of paused) {
      try {
        await pause(dependency, false);
      } catch (error) {
        errors.push(error);
      }
    }
    const results = await Promise.allSettled(
      Object.values(containers).map((container) =>
        container.stop({ timeout: 10_000, remove: true, removeVolumes: true }),
      ),
    );
    for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
    if (errors.length)
      throw new AggregateError(errors, 'No se pudo limpiar la infraestructura de prueba');
  }

  try {
    containers.postgres = await new GenericContainer(images.postgres)
      .withEnvironment({
        POSTGRES_USER: username,
        POSTGRES_PASSWORD: password,
        POSTGRES_DB: database,
      })
      .withExposedPorts(5432)
      .withHealthCheck({
        test: ['CMD-SHELL', 'pg_isready -U integration -d platform_test'],
        interval: 1000,
        timeout: 1000,
        retries: 60,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    containers.redis = await new GenericContainer(images.redis)
      .withExposedPorts(6379)
      .withHealthCheck({
        test: ['CMD', 'redis-cli', 'ping'],
        interval: 1000,
        timeout: 1000,
        retries: 60,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
    containers.rabbitmq = await new GenericContainer(images.rabbitmq)
      .withEnvironment({
        RABBITMQ_DEFAULT_USER: username,
        RABBITMQ_DEFAULT_PASS: password,
        RABBITMQ_DEFAULT_VHOST: vhost,
        RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2',
        RABBITMQ_CTL_ERL_ARGS: '+S 1:1',
      })
      .withExposedPorts(5672)
      .withHealthCheck({
        test: [
          'CMD-SHELL',
          'rabbitmq-diagnostics -q check_running && rabbitmq-diagnostics -q check_port_connectivity',
        ],
        interval: 1000,
        timeout: 5000,
        startPeriod: 15_000,
        retries: 60,
      })
      .withWaitStrategy(Wait.forHealthCheck())
      .withStartupTimeout(120_000)
      .start();
  } catch (error) {
    try {
      await stop();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Arranque y limpieza fallidos');
    }
    throw error;
  }

  const endpoint = (dependency: Dependency, port: number) =>
    `${containers[dependency].getHost()}:${containers[dependency].getMappedPort(port)}`;
  return {
    containers,
    pause,
    stop,
    password,
    get databaseUrl() {
      return `postgresql://${username}:${password}@${endpoint('postgres', 5432)}/${database}`;
    },
    get redisUrl() {
      return `redis://${endpoint('redis', 6379)}`;
    },
    get rabbitmqUrl() {
      return `amqp://${username}:${password}@${endpoint('rabbitmq', 5672)}/${vhost}`;
    },
  };
}

export type Infrastructure = Awaited<ReturnType<typeof startInfrastructure>>;
