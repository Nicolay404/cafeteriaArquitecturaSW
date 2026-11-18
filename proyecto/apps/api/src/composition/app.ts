import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Pool } from 'pg';
import { PersonasRepository, PiiCipher } from '../modules/clientes/index.js';
import {
  BackgroundMail,
  HibpChecker,
  LoginService,
  PasswordPolicy,
  RateLimiter,
  RegistrationService,
  SecurityEvents,
  SessionStore,
  buildIdentidadModule,
} from '../modules/identidad/index.js';
import { SmtpMail } from '../modules/notificaciones/index.js';
import { FlagsService } from '../platform/flags.service.js';
import { buildPlatformModule } from '../platform/platform.module.js';
import type { PlatformConfig } from '../platform/platform.module.js';
import { PgDatabase } from './pg-database.js';

// Raíz de composición: el único lugar que conoce a la vez `pg`, Redis, SMTP y los módulos de
// dominio. Construye los servicios con sus dependencias y arma la aplicación Nest.
export interface AppConfig extends PlatformConfig {
  appEnv: string;
  webOrigin: string;
  smtpHost: string;
  smtpPort: number;
  piiKeys: Readonly<Record<number, string>>;
  piiIndexKey: string;
  sessionSecret: string;
  hibpEnabled: boolean;
}

export async function createApp(config: AppConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  pool.on('error', () => {});
  const db = new PgDatabase(pool);
  const prefix = config.flagsPrefix.replace(/:flags$/, '');

  const cipher = new PiiCipher({ keys: config.piiKeys, indexKey: config.piiIndexKey });
  const personas = new PersonasRepository(db, cipher);
  const limiter = new RateLimiter({ redisUrl: config.redisUrl, prefix: `${prefix}:limite` });
  const sessions = new SessionStore({
    redisUrl: config.redisUrl,
    prefix: `${prefix}:sesiones`,
    secret: config.sessionSecret,
  });
  const events = new SecurityEvents(db);
  const smtp = new SmtpMail({ host: config.smtpHost, port: config.smtpPort });
  const mail = new BackgroundMail(smtp);
  const policy = new PasswordPolicy(config.hibpEnabled ? new HibpChecker() : undefined);
  const flags = new FlagsService(config);

  const shared = {
    db,
    personas,
    cipher,
    policy,
    limiter,
    events,
    mail,
    webOrigin: config.webOrigin,
  };
  const identidad = buildIdentidadModule({
    registration: new RegistrationService(shared),
    login: new LoginService({ ...shared, sessions }),
    sessions,
    events,
    isEnabled: () => flags.isEnabled('identidad-habilitada'),
    cookieSecure: config.appEnv !== 'local',
  });

  // Al cerrar la aplicación (app.close o una señal) se liberan las conexiones propias.
  const cleanup = {
    async onModuleDestroy() {
      await mail.idle();
      smtp.close();
      await Promise.allSettled([limiter.close(), sessions.close(), pool.end()]);
    },
  };

  @Module({
    imports: [buildPlatformModule(config), identidad],
    providers: [{ provide: 'LIMPIEZA', useValue: cleanup }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false });
  app.enableShutdownHooks();
  return { app, mail };
}
