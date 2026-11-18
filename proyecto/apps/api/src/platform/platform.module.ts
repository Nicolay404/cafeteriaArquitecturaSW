import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CapabilityController } from './capability.controller.js';
import { FlagsService } from './flags.service.js';
import type { FlagsConfig } from './flags.service.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import type { HealthConfig } from './health.service.js';

export type PlatformConfig = HealthConfig & FlagsConfig;

/** Módulo técnico de la plataforma: salud y flags. No contiene lógica de dominio. */
export function buildPlatformModule(config: PlatformConfig) {
  @Module({
    controllers: [HealthController, CapabilityController],
    providers: [
      { provide: HealthService, useValue: new HealthService(config) },
      { provide: FlagsService, useValue: new FlagsService(config) },
    ],
  })
  class PlatformModule {}
  return PlatformModule;
}

/** Crea la aplicación sin escuchar todavía: la usan el arranque real y las pruebas. */
export async function createPlatformApp(config: PlatformConfig) {
  const app = await NestFactory.create(buildPlatformModule(config), { logger: false });
  app.enableShutdownHooks();
  return app;
}
