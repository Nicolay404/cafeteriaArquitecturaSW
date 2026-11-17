import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { createClient } from 'redis';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { within } from './probes.fixture.js';
import { startInfrastructure } from './infrastructure.fixture.js';
import type { Infrastructure } from './infrastructure.fixture.js';
import { runPlatformProbe, startPlatformWorker } from '../../apps/worker/src/platform-probe.js';

describe('T012 — señal privada del worker', () => {
  let infrastructure: Infrastructure;
  beforeAll(async () => {
    infrastructure = await startInfrastructure();
  });

  test('el cierre limpia heartbeat y temporizador sin servidor HTTP', async () => {
    const worker = await startPlatformWorker(
      {
        redisUrl: infrastructure.redisUrl,
        rabbitmqUrl: infrastructure.rabbitmqUrl,
        version: 'worker-stop',
        appEnv: 'local',
      },
      'worker-stop',
    );
    const redis = createClient({ url: infrastructure.redisUrl });
    try {
      await redis.connect();
      expect(await redis.get('cafeteria:local:worker:heartbeat:worker-stop')).not.toBeNull();
      await worker.stop();
      expect(await redis.get('cafeteria:local:worker:heartbeat:worker-stop')).toBeNull();
    } finally {
      await worker.stop();
      if (redis.isOpen) redis.destroy();
    }
  });
  afterAll(async () => {
    await infrastructure?.stop();
  });

  test('main inicia sin HTTP y ejecuta su cierre SIGTERM también en Windows', async () => {
    // The test-only wrapper emits the signal inside the child: Windows kill()
    // terminates a process forcibly and would not exercise its signal handler.
    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `process.on('message', (message) => { if (message === 'shutdown') process.emit('SIGTERM'); }); import('./apps/worker/src/main.ts');`,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: {
          ...process.env,
          ...parseEnv(readFileSync(new URL('../../.env.example', import.meta.url), 'utf8')),
          TSX_TSCONFIG_PATH: fileURLToPath(
            new URL('../../apps/worker/tsconfig.json', import.meta.url),
          ),
          REDIS_URL: infrastructure.redisUrl,
          RABBITMQ_URL: infrastructure.rabbitmqUrl,
          APP_VERSION: 'worker-process-test',
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      },
    );
    // The IPC channel belongs to the harness, not the product. Disconnect it
    // after sending shutdown so it cannot keep an otherwise clean child alive.
    const exited = once(child, 'exit');
    const ready = new Promise<string>((resolve, reject) => {
      let output = '';
      child.stdout!.on('data', (chunk: Buffer) => {
        output += chunk.toString();
        const line = output.split('\n').find((item) => item.includes('"worker_ready"'));
        if (line) resolve(line);
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Worker terminó antes de readiness')));
    });
    const redis = createClient({ url: infrastructure.redisUrl });
    try {
      const signal = JSON.parse(await within(ready, 20_000)) as {
        instanceId: string;
        version: string;
      };
      expect(signal.version).toBe('worker-process-test');
      await redis.connect();
      const key = `cafeteria:local:worker:heartbeat:${signal.instanceId}`;
      expect(await redis.get(key)).not.toBeNull();
      child.send('shutdown', () => child.disconnect());
      const [code] = await within(exited, 10_000);
      expect(code).toBe(0);
      expect(await redis.get(key)).toBeNull();
    } finally {
      if (redis.isOpen) redis.destroy();
      if (child.exitCode === null) child.kill();
    }
  });

  test('publica/consume correlacionado y guarda versión/timestamp con TTL en Redis', async () => {
    const signal = await runPlatformProbe(
      {
        redisUrl: infrastructure.redisUrl,
        rabbitmqUrl: infrastructure.rabbitmqUrl,
        version: 'worker-test',
        appEnv: 'local',
      },
      'worker-integration',
    );
    const redis = createClient({ url: infrastructure.redisUrl });
    try {
      await redis.connect();
      expect(JSON.parse((await redis.get(signal.key))!)).toEqual(signal.value);
      expect(signal.value.version).toBe('worker-test');
      expect(Number.isNaN(Date.parse(signal.value.timestamp))).toBe(false);
      expect(await redis.ttl(signal.key)).toBeGreaterThan(0);
      expect(await redis.ttl(signal.key)).toBeLessThanOrEqual(30);
      await redis.del(signal.key);
    } finally {
      if (redis.isOpen) redis.destroy();
    }
  });
});
