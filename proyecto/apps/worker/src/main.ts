import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readWorkerConfig } from './config.js';
import { startPlatformWorker } from './platform-probe.js';
import { ConfigurationError } from '../../../packages/config/src/env.js';

async function main() {
  const config = readWorkerConfig();
  @Module({})
  class WorkerModule {}
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
  const worker = await startPlatformWorker(config);
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await worker.stop();
    } finally {
      await app.close();
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stop().catch(() => {
        console.error('No se pudo completar el cierre del worker');
        process.exitCode = 1;
      });
    });
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof ConfigurationError ? error.message : 'No se pudo iniciar el worker',
  );
  process.exitCode = 1;
});
