import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AuthController, IDENTIDAD_DEPS } from './auth.controller.js';
import type { IdentidadDeps } from './auth.controller.js';
import { AccessGuard } from './guards.js';
import type { SecurityEvents } from './security-events.js';

@Module({})
export class IdentidadModule {}

/**
 * Módulo de Identidad ya cableado con sus servicios (la raíz de composición los construye: así el
 * dominio no conoce `pg`, Redis ni SMTP). El guard de acceso es global pero solo actúa en las
 * rutas con @Access().
 */
export function buildIdentidadModule(deps: IdentidadDeps & { events: SecurityEvents }) {
  @Module({
    controllers: [AuthController],
    providers: [
      { provide: IDENTIDAD_DEPS, useValue: deps },
      {
        provide: APP_GUARD,
        inject: [Reflector],
        useFactory: (reflector: Reflector) =>
          new AccessGuard(reflector, deps.sessions, deps.events),
      },
    ],
  })
  class IdentidadWiredModule {}
  return IdentidadWiredModule;
}
