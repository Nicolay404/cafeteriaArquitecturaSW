import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readApiConfig } from './platform/config.js';
import { ConfigurationError } from '../../../packages/config/src/env.js';
import { HealthController } from './platform/health.controller.js';
import { HealthService } from './platform/health.service.js';

async function main() {
  const config = readApiConfig();
  @Module({
    controllers: [HealthController],
    providers: [{ provide: HealthService, useValue: new HealthService(config) }],
  })
  class PlatformModule {}
  const app = await NestFactory.create(PlatformModule, { logger: false });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

main().catch((error: unknown) => {
  console.error(error instanceof ConfigurationError ? error.message : 'No se pudo iniciar la API');
  process.exitCode = 1;
});
