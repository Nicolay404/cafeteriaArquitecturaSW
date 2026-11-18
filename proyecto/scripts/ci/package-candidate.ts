import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { buildCandidate, candidateId } from '../../packages/contracts/src/candidate.js';
import type { Candidate } from '../../packages/contracts/src/candidate.js';
import { run, withWorktree } from '../../../scripts/ci/verify-commits.js';
import { loadMigrations } from '../db/migrate.js';

// Identidad por CONTENIDO (FR-012): lo que se prueba en un entorno es exactamente lo que se
// promueve al siguiente. Este módulo calcula los hashes del manifiesto y arma el candidato: las
// tres imágenes (API, worker y web) construidas desde un checkout LIMPIO del commit indicado.

/**
 * Carpetas que Next escribe DENTRO de `.next` al servir la web y que no forman parte del paquete:
 * caché de imágenes/datos (`cache`) y la caché de rutas prerenderizadas (`route-cache`), que se
 * genera la primera vez que se sirve cada página. Se excluyen a propósito y por nombre exacto.
 */
export const WEB_RUNTIME_CACHE = ['cache', 'route-cache'];

/**
 * Hash sha256 del contenido de una carpeta: depende de las rutas relativas y de los bytes de cada
 * archivo, no del orden de creación ni de fechas. `exclude` omite carpetas o archivos por NOMBRE a
 * cualquier profundidad (por ejemplo la caché de compilación). Falla si la carpeta no existe.
 */
export function hashDirectory(directory: string, options: { exclude?: string[] } = {}): string {
  const exclude = new Set(options.exclude ?? []);
  const lines: string[] = [];

  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) {
        const content = createHash('sha256').update(readFileSync(full)).digest('hex');
        // Longitud de la ruta delante: «a»+«bc» no se confunde con «ab»+«c».
        lines.push(`${relative.length}:${relative}\u0000${content}`);
      }
    }
  };
  walk(directory, '');

  lines.sort((a, b) => a.localeCompare(b, 'en'));
  return `sha256:${createHash('sha256').update(lines.join('\n')).digest('hex')}`;
}

/** Checksum sha256 (hexadecimal) de cada migración, por versión: el mismo que registra el runner. */
export function migrationChecksums(directory: string): Record<string, string> {
  return Object.fromEntries(
    loadMigrations(directory).map((migration) => [migration.version, migration.checksum]),
  );
}

// ---- Ensamblado del candidato ----

export type DockerRunner = (args: string[]) => Promise<{ code: number; stdout: string }>;

/** Ejecuta `docker` sin shell y devuelve su salida estándar (la de error pasa a la consola). */
export const spawnDocker: DockerRunner = (args) =>
  new Promise((resolveResult) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', (chunk) => (stdout += String(chunk)));
    child.on('error', () => resolveResult({ code: 1, stdout }));
    child.on('close', (code) => resolveResult({ code: code ?? 1, stdout }));
  });

export interface Prepared {
  /** Raíz de un checkout limpio del commit (la que contiene `proyecto/`). */
  directory: string;
  cleanup: () => Promise<void>;
}

export interface PackageOptions {
  sha: string;
  docker: DockerRunner;
  outDir: string;
  reportRefs: string[];
  configRevision: string;
  /** Solo para pruebas: por defecto se usa un `git worktree` del commit. */
  prepare?: (sha: string) => Promise<Prepared>;
}

export interface PackagedCandidate {
  candidate: Candidate;
  id: string;
  path: string;
}

const APPS = ['api', 'worker', 'web'] as const;

async function assemble(directory: string, options: PackageOptions): Promise<PackagedCandidate> {
  const context = join(directory, 'proyecto');
  const tag = options.sha.slice(0, 12);
  const image = (app: string) => `cafeteria-${app}:${tag}`;

  for (const app of APPS) {
    const built = await options.docker([
      'build',
      '--quiet',
      '-f',
      `apps/${app}/Dockerfile`,
      '-t',
      image(app),
      context,
    ]);
    if (built.code !== 0) throw new Error(`Falló la construcción de la imagen ${app}`);
  }

  const digestOf = async (app: string) => {
    const inspected = await options.docker(['image', 'inspect', '--format', '{{.Id}}', image(app)]);
    return inspected.stdout.trim();
  };

  // El hash de la web es el de lo COMPILADO que lleva la imagen, sin las cachés de ejecución.
  const created = await options.docker(['create', image('web')]);
  const container = created.stdout.trim();
  const scratch = mkdtempSync(join(tmpdir(), 'cafeteria-web-'));
  let hashWeb: string;
  try {
    // «/.» copia el CONTENIDO de .next dentro de `scratch` y no una carpeta .next anidada.
    const copied = await options.docker(['cp', `${container}:/app/.next/.`, scratch]);
    if (copied.code !== 0) throw new Error('No se pudo extraer la compilación de la web');
    hashWeb = hashDirectory(scratch, { exclude: WEB_RUNTIME_CACHE });
  } finally {
    await options.docker(['rm', container]);
    rmSync(scratch, { recursive: true, force: true });
  }

  const candidate = buildCandidate({
    sha: options.sha,
    digestApi: await digestOf('api'),
    digestWorker: await digestOf('worker'),
    hashWeb,
    migrationChecksums: migrationChecksums(join(context, 'infra/migrations')),
    configRevision: options.configRevision,
    reportRefs: options.reportRefs,
  });
  const id = candidateId(candidate);
  mkdirSync(options.outDir, { recursive: true });
  const path = join(options.outDir, `${id}.json`);
  writeFileSync(path, `${JSON.stringify({ id, ...candidate }, null, 2)}\n`);
  return { candidate, id, path };
}

/** Arma el candidato de un commit: imágenes, hash de la web, checksums y manifiesto inmutable. */
export async function packageCandidate(options: PackageOptions): Promise<PackagedCandidate> {
  // Se valida todo lo que no necesita Docker antes de construir nada.
  const placeholder = `sha256:${'0'.repeat(64)}`;
  buildCandidate({
    sha: options.sha,
    digestApi: placeholder,
    digestWorker: placeholder,
    hashWeb: placeholder,
    migrationChecksums: {},
    configRevision: options.configRevision,
    reportRefs: options.reportRefs,
  });

  if (options.prepare) {
    const prepared = await options.prepare(options.sha);
    try {
      return await assemble(prepared.directory, options);
    } finally {
      await prepared.cleanup();
    }
  }
  const top = await run(process.cwd(), 'rev-parse', '--show-toplevel');
  return withWorktree(top, options.sha, (directory) => assemble(directory, options));
}

// ---- CLI ----

/** Carpeta fija de los manifiestos: el CLI no acepta una ruta de salida por argumento. */
export const CANDIDATES_DIR = 'candidates';

async function main(args: string[]): Promise<number> {
  try {
    const { values } = parseArgs({
      args,
      options: { sha: { type: 'string', default: 'HEAD' } },
    });
    const requested = values.sha!;
    if (requested !== 'HEAD' && !/^[0-9a-f]{40}$/.test(requested))
      throw new Error('--sha debe ser HEAD o un SHA completo en minúsculas');
    const sha = await run(process.cwd(), 'rev-parse', '--verify', `${requested}^{commit}`);
    // Revisión de la configuración: huella del ejemplo versionado (solo valores públicos).
    const example = readFileSync(resolve('.env.example'));
    const configRevision = `env-example-${createHash('sha256').update(example).digest('hex').slice(0, 12)}`;
    const result = await packageCandidate({
      sha,
      docker: spawnDocker,
      outDir: resolve(CANDIDATES_DIR),
      reportRefs: [],
      configRevision,
    });
    console.log(`Candidato ${result.id}`);
    console.log(`  sha            ${result.candidate.sha}`);
    console.log(`  api            ${result.candidate.digestApi}`);
    console.log(`  worker         ${result.candidate.digestWorker}`);
    console.log(`  web (hash)     ${result.candidate.hashWeb}`);
    console.log(
      `  migraciones    ${Object.keys(result.candidate.migrationChecksums).join(', ') || 'ninguna'}`,
    );
    console.log(`  manifiesto     ${result.path}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo armar el candidato');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
