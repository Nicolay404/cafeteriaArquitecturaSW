import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { runPlatformProbe, startPlatformWorker } from './platform-probe.js';

const secret = 'clave-unitaria-no-reutilizable';
const config = {
  appEnv: 'local',
  version: '0.0.0-unit',
  rabbitmqUrl: `amqp://usuario:${secret}@127.0.0.1:1/vhost`,
  redisUrl: `redis://:${secret}@127.0.0.1:1`,
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('worker técnico ante broker no disponible', () => {
  it('el sondeo falla sin escribir señal de actividad', async () => {
    await expect(runPlatformProbe(config, 'instancia-unitaria')).rejects.toThrow();
  });

  it('sigue vivo, registra indisponibilidad sin secretos y cierra limpio sin señal que borrar', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const worker = await startPlatformWorker(config, 'instancia-unitaria');
    await expect(worker.stop()).resolves.toBeUndefined();

    expect(log).not.toHaveBeenCalled();
    expect(warn.mock.calls.map(([message]) => JSON.parse(String(message)))).toEqual([
      { event: 'worker_unavailable', version: '0.0.0-unit' },
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
  });
});
