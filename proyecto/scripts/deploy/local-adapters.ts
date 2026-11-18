import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { candidateId, parseCandidate } from '../../packages/contracts/src/candidate.js';
import type { Candidate } from '../../packages/contracts/src/candidate.js';
import type { Deployment } from '../../packages/contracts/src/deployment.js';
import type { EnvironmentType } from '../../packages/contracts/src/environment.js';
import { migrationChecksums } from '../ci/package-candidate.js';
import { migrate } from '../db/migrate.js';
import type { Adapters, Approval } from './release.js';

// Adaptadores LOCALES del orquestador: cada «entorno» es un proyecto de Docker Compose con su
// propia infraestructura y las imágenes del candidato. Ensaya promoción, aprobación, migración,
// smoke y rollback de verdad, pero NO es una plataforma de producción (ver alcance-local.md).

export interface LocalEnvironment {
  project: string;
  web: number;
  api: number;
  postgres: number;
  redis: number;
  mailpit: number;
}

/**
 * Puertos de cada entorno a partir de una base. Algunos sistemas reservan rangos enteros (Windows
 * reserva 3478–4377 en muchos equipos): por eso la base es configurable con RELEASE_PORT_BASE.
 */
export function localEnvironments(base = 5100): Record<EnvironmentType, LocalEnvironment> {
  return {
    staging: {
      project: 'cafeteria-staging',
      web: base,
      api: base + 1,
      postgres: base + 50_000,
      redis: base + 49_000,
      mailpit: base + 48_000,
    },
    production: {
      project: 'cafeteria-production',
      web: base + 100,
      api: base + 101,
      postgres: base + 50_100,
      redis: base + 49_100,
      mailpit: base + 48_100,
    },
    preview: {
      project: 'cafeteria-preview',
      web: base + 200,
      api: base + 201,
      postgres: base + 50_200,
      redis: base + 49_200,
      mailpit: base + 48_200,
    },
  };
}

export const LOCAL_ENVIRONMENTS = localEnvironments();

export type Phase = 'migrate' | 'backend' | 'web' | 'smoke' | 'restore';
export const PHASES: readonly Phase[] = ['migrate', 'backend', 'web', 'smoke', 'restore'];

export type Runner = (
  command: string,
  args: string[],
  environment: Record<string, string>,
) => Promise<{ code: number; output: string }>;

/** Ejecuta un comando sin shell y devuelve su salida combinada. */
export const spawnRunner: Runner = (command, args, environment) =>
  new Promise((resolveResult) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.on('error', (error) => resolveResult({ code: 1, output: error.message }));
    child.on('close', (code) => resolveResult({ code: code ?? 1, output }));
  });

export interface LocalOptions {
  environment: EnvironmentType;
  /** Raíz de proyecto/ (donde están infra/ y las carpetas de estado). */
  root: string;
  run?: Runner;
  fetcher?: typeof fetch;
  /** Solo para ensayos: hace fallar a propósito una fase para probar el rollback. */
  inject?: Phase;
  /** Base de los puertos del entorno (por defecto 5100). */
  portBase?: number;
  /** Pausa entre intentos del smoke; se acorta en las pruebas. */
  retryDelayMs?: number;
  migrationsDir?: string;
}

export const RELEASE_DIR = '.release';
export const MANIFESTS_DIR = 'candidates';

const DATABASE = (port: number) =>
  `postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:${port}/cafeteria_local`;

/** Busca un manifiesto LISTANDO la carpeta y comparando nombres: el id recibido nunca forma una ruta. */
export function findManifest(directory: string, id: string): Candidate | undefined {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return undefined;
  }
  const match = names.find((name) => name === `${id}.json`);
  if (!match) return undefined;
  return parseCandidate(JSON.parse(readFileSync(join(directory, match), 'utf8')));
}

export function readJsonList<T>(file: string): T[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeJsonList(directory: string, name: string, value: unknown[]) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
}

export function stackVariables(
  environment: EnvironmentType,
  candidate: Candidate,
  images: { api: string; worker: string; web: string },
  portBase?: number,
): Record<string, string> {
  const settings = localEnvironments(portBase)[environment];
  return {
    APP_ENV: environment,
    APP_VERSION: candidate.sha,
    API_IMAGE: images.api,
    WORKER_IMAGE: images.worker,
    WEB_IMAGE: images.web,
    API_HOST_PORT: String(settings.api),
    WEB_HOST_PORT: String(settings.web),
    POSTGRES_HOST_PORT: String(settings.postgres),
    REDIS_HOST_PORT: String(settings.redis),
    MAILPIT_HOST_PORT: String(settings.mailpit),
  };
}

export function createLocalAdapters(options: LocalOptions): Adapters {
  const run = options.run ?? spawnRunner;
  const fetcher = options.fetcher ?? fetch;
  const settings = localEnvironments(options.portBase)[options.environment];
  const stateDir = join(options.root, RELEASE_DIR);
  const manifests = join(options.root, MANIFESTS_DIR);
  const stackFile = join(options.root, 'infra/stack.compose.yaml');
  const wait = options.retryDelayMs ?? 1000;

  const maybeFail = (phase: Phase) => {
    if (options.inject === phase)
      throw new Error(`Fallo inyectado a propósito en la fase «${phase}»`);
  };

  /** Etiqueta las imágenes del candidato (por su digest) con un nombre propio para Compose. */
  async function tagImages(candidate: Candidate) {
    const id = candidateId(candidate);
    const refs = {
      api: `cafeteria-api:${id}`,
      worker: `cafeteria-worker:${id}`,
      web: `cafeteria-web:${id}`,
    };
    const pairs: Array<[string, string]> = [
      [candidate.digestApi, refs.api],
      [candidate.digestWorker, refs.worker],
      [candidate.digestWeb, refs.web],
    ];
    for (const [digest, tag] of pairs) {
      const tagged = await run('docker', ['tag', digest, tag], {});
      if (tagged.code !== 0)
        throw new Error(`No se pudo etiquetar la imagen ${tag}: ${tagged.output.trim()}`);
    }
    return refs;
  }

  async function up(candidate: Candidate, services: string[], what: string) {
    const refs = await tagImages(candidate);
    const result = await run(
      'docker',
      [
        'compose',
        '-p',
        settings.project,
        '-f',
        stackFile,
        'up',
        '-d',
        '--wait',
        '--wait-timeout',
        '120',
        ...services,
      ],
      stackVariables(options.environment, candidate, refs, options.portBase),
    );
    if (result.code !== 0)
      throw new Error(`${what} falló: ${result.output.trim().split('\n').slice(-3).join(' | ')}`);
  }

  /** Verdadero solo cuando la web, su proxy y la API responden CON LA VERSIÓN del candidato. */
  async function healthy(version: string): Promise<boolean> {
    const web = `http://127.0.0.1:${settings.web}`;
    const api = `http://127.0.0.1:${settings.api}`;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const [home, proxied, live] = await Promise.all([
          fetcher(`${web}/`, { signal: AbortSignal.timeout(3000) }),
          fetcher(`${web}/api/health`, { signal: AbortSignal.timeout(3000) }),
          fetcher(`${api}/health/live`, { signal: AbortSignal.timeout(3000) }),
        ]);
        if (home.ok && proxied.ok && live.ok) {
          const body = (await proxied.json()) as { status?: string; version?: string };
          // Durante un relevo puede responder todavía la versión anterior: se reintenta.
          if (body.status === 'ok' && body.version === version) return true;
        }
      } catch {
        /* el entorno todavía arranca */
      }
      await delay(wait);
    }
    return false;
  }

  return {
    approval: async (id): Promise<Approval | null> =>
      readJsonList<Approval>(join(stateDir, 'approvals.json')).find(
        (item) => item.candidateId === id,
      ) ?? null,

    migrate: async (candidate) => {
      maybeFail('migrate');
      // Las migraciones del repositorio deben ser EXACTAMENTE las que lleva el candidato.
      const directory = options.migrationsDir ?? join(options.root, 'infra/migrations');
      const byName = ([a]: [string, string], [b]: [string, string]) => a.localeCompare(b, 'en');
      const actual = JSON.stringify(Object.entries(migrationChecksums(directory)).sort(byName));
      if (actual !== JSON.stringify(Object.entries(candidate.migrationChecksums).sort(byName)))
        throw new Error('Las migraciones del repositorio no coinciden con las del candidato');
      await up(candidate, ['postgres'], 'La base de datos');
      await migrate({ databaseUrl: DATABASE(settings.postgres), directory, lockTimeoutMs: 20_000 });
    },

    deployBackend: async (candidate) => {
      maybeFail('backend');
      await up(candidate, ['api', 'worker'], 'El despliegue del backend');
    },

    deployFrontend: async (candidate) => {
      maybeFail('web');
      await up(candidate, ['web'], 'El despliegue de la web');
    },

    smoke: async (candidate) => {
      maybeFail('smoke');
      return healthy(candidate.sha);
    },

    restore: async (previous: Deployment) => {
      maybeFail('restore');
      const candidate = findManifest(manifests, previous.candidateId);
      if (!candidate)
        throw new Error(
          `No existe el manifiesto del despliegue anterior (${previous.candidateId})`,
        );
      await up(candidate, ['api', 'worker', 'web'], 'La restauración');
      return healthy(candidate.sha);
    },

    alert: async (message) => {
      mkdirSync(stateDir, { recursive: true });
      appendFileSync(join(stateDir, 'alerts.log'), `${new Date().toISOString()} ${message}\n`);
      console.warn(`ALERTA: ${message}`);
    },
  };
}
