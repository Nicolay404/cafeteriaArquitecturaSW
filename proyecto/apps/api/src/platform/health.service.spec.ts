import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { HealthService } from './health.service.js';

// Puerto 1 en loopback: conexión rechazada sin depender de Docker ni de la red.
const secret = 'clave-unitaria-no-reutilizable';
const config = {
  version: '0.0.0-unit',
  databaseUrl: `postgresql://usuario:${secret}@127.0.0.1:1/base`,
  redisUrl: `redis://:${secret}@127.0.0.1:1`,
  rabbitmqUrl: `amqp://usuario:${secret}@127.0.0.1:1/vhost`,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('HealthService sin dependencias disponibles', () => {
  it('informa no disponible y registra solo el nombre de cada dependencia, sin URLs ni credenciales', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const started = Date.now();

    await expect(new HealthService(config).ready()).resolves.toBe(false);

    expect(Date.now() - started).toBeLessThan(3000);
    const logged = warn.mock.calls.map(([message]) => JSON.parse(String(message)));
    expect(logged).toEqual([
      { event: 'health_dependency_unavailable', dependency: 'postgres' },
      { event: 'health_dependency_unavailable', dependency: 'redis' },
      { event: 'health_dependency_unavailable', dependency: 'rabbitmq' },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(new RegExp(`${secret}|127\\.0\\.0\\.1`));
  });

  it('expone la versión configurada sin consultar dependencias', () => {
    expect(new HealthService(config).version).toBe('0.0.0-unit');
  });
});
