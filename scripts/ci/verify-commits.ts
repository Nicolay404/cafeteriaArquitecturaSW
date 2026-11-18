import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';

// Constitución VII y FR-002: cada commit de un PR debe ser válido y verde POR SÍ SOLO, no solo
// la cabeza. Recorre base..head, comprueba el mensaje y verifica cada commit en un checkout
// temporal aislado (git worktree), sin cambiar la rama, el índice ni el árbol de trabajo.
// Solo usa módulos de Node: se ejecuta desde la raíz Git con tsx de proyecto/.

const git = promisify(execFile);

export interface CommandResult {
  code: number;
  output: string;
}
export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; input?: string | undefined },
) => Promise<CommandResult>;

export interface VerifyCommands {
  /** Valida el mensaje; lo recibe por entrada estándar. */
  message: string[];
  /** Instalación con el lockfile propio de cada commit. */
  install: string[];
  /** Comprobaciones completas, cuando cambia la raíz del workspace. */
  full: string[][];
  /** Comprobaciones de lo afectado; `{parent}` se sustituye por el SHA del padre. */
  affected: string[][];
}

export type Mode = 'documentacion' | 'aplicacion' | 'raiz';
export type Stage = 'mensaje' | 'historial' | 'instalacion' | 'comprobacion';

export interface CommitReport {
  sha: string;
  subject: string;
  mode: Mode | 'n/a';
  status: 'ok' | 'fallo';
  stage?: Stage;
  detail?: string;
}

export interface VerifyReport {
  ok: boolean;
  commits: CommitReport[];
}

const documentation = [/\.(md|mdx|txt)$/i, /^specs\//, /^docs\//, /^\.specify\//, /^LICENSE/];
// Cambios que NO obligan a repetir todo: código y pruebas de aplicación. Cualquier otro
// archivo (manifiestos, lockfile, configuración, infraestructura, CI, hooks) verifica todo.
const applicationOnly = [
  /^proyecto\/apps\//,
  /^proyecto\/packages\/(contracts|ui)\//,
  /^proyecto\/tests\//,
  /^proyecto\/scripts\//,
];

/** Clasifica los archivos de un commit. Ante la duda, `raiz` (comprobación completa). */
export function classifyChange(files: string[]): Mode {
  if (files.length === 0) return 'documentacion';
  if (files.every((file) => documentation.some((pattern) => pattern.test(file))))
    return 'documentacion';
  const sources = files.filter((file) => !documentation.some((pattern) => pattern.test(file)));
  return sources.every((file) => applicationOnly.some((pattern) => pattern.test(file)))
    ? 'aplicacion'
    : 'raiz';
}

export const spawnRunner: CommandRunner = (command, args, options) =>
  new Promise((resolveResult) => {
    // En Windows pnpm/npm son shims .cmd y necesitan shell; sus argumentos no llevan espacios.
    const shell = process.platform === 'win32' && /^(pnpm|npm|npx|corepack)$/.test(command);
    const child = spawn(command, args, { cwd: options.cwd, shell });
    let output = '';
    child.stdout.on('data', (chunk) => (output += String(chunk)));
    child.stderr.on('data', (chunk) => (output += String(chunk)));
    child.on('error', (error) => resolveResult({ code: 1, output: `${output}${error.message}` }));
    child.on('close', (code) => resolveResult({ code: code ?? 1, output }));
    child.stdin.end(options.input ?? '');
  });

const tail = (text: string, lines = 30) => text.trimEnd().split(/\r?\n/).slice(-lines).join('\n');

export async function run(repo: string, ...args: string[]) {
  const { stdout } = await git('git', ['-C', repo, ...args], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.trim();
}

export async function resolveCommit(repo: string, ref: string, label: string) {
  try {
    return await run(repo, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(`No se pudo resolver la ${label} «${ref}» en el repositorio`);
  }
}

export async function verifyCommits(options: {
  repo: string;
  base: string;
  head?: string;
  commands: VerifyCommands;
  runner?: CommandRunner;
  keepGoing?: boolean;
}): Promise<VerifyReport> {
  const runner = options.runner ?? spawnRunner;
  const top = await run(options.repo, 'rev-parse', '--show-toplevel');
  const base = await resolveCommit(top, options.base, 'base');
  const head = await resolveCommit(top, options.head ?? 'HEAD', 'cabeza');
  const listing = await run(top, 'rev-list', '--reverse', '--parents', `${base}..${head}`);
  const entries = listing
    ? listing.split('\n').map((line) => {
        const [sha, ...parents] = line.split(' ');
        return { sha: sha!, parents };
      })
    : [];

  const subjectOf = (sha: string) => run(top, 'show', '-s', '--format=%s', sha);
  const commits: CommitReport[] = [];

  const merges = entries.filter((entry) => entry.parents.length !== 1);
  if (merges.length > 0) {
    for (const merge of merges)
      commits.push({
        sha: merge.sha,
        subject: await subjectOf(merge.sha),
        mode: 'n/a',
        status: 'fallo',
        stage: 'historial',
        detail: 'El historial debe ser lineal: usa rebase, sin commits de merge',
      });
    return { ok: false, commits };
  }

  for (const { sha, parents } of entries) {
    const subject = await subjectOf(sha);
    const message = await run(top, 'show', '-s', '--format=%B', sha);
    const [messageCommand, ...messageArgs] = options.commands.message;
    const lint = await runner(messageCommand!, messageArgs, {
      cwd: top,
      input: message,
    });
    if (lint.code !== 0) {
      commits.push({
        sha,
        subject,
        mode: 'n/a',
        status: 'fallo',
        stage: 'mensaje',
        detail: tail(lint.output),
      });
      if (!options.keepGoing) return { ok: false, commits };
      continue;
    }

    const files = (await run(top, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha))
      .split('\n')
      .filter(Boolean);
    const mode = classifyChange(files);
    if (mode === 'documentacion') {
      commits.push({ sha, subject, mode, status: 'ok' });
      continue;
    }

    const result = await verifyInWorktree(top, sha, parents[0]!, mode, options.commands, runner);
    commits.push({ sha, subject, mode, ...result });
    if (result.status === 'fallo' && !options.keepGoing) return { ok: false, commits };
  }
  return { ok: commits.every((item) => item.status === 'ok'), commits };
}

/**
 * Ejecuta `action` en un checkout temporal aislado (git worktree) de `ref`, sin cambiar la
 * rama, el índice ni el árbol de trabajo, y lo borra siempre. Lo usan la verificación de
 * commits y la de revert.
 */
export async function withWorktree<T>(
  top: string,
  ref: string,
  action: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'cafeteria-verify-'));
  try {
    await run(top, 'worktree', 'add', '--detach', '--quiet', directory, ref);
    return await action(directory);
  } finally {
    // La limpieza nunca puede tapar el veredicto: en Windows un proceso hijo (p. ej. Turbo)
    // puede tardar en soltar el directorio, así que se reintenta y, si no se logra, se avisa.
    await run(top, 'worktree', 'remove', '--force', directory).catch(() => undefined);
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }).catch(
      () => console.warn(`Aviso: no se pudo borrar el directorio temporal ${directory}`),
    );
    await run(top, 'worktree', 'prune').catch(() => undefined);
  }
}

/** Instala y ejecuta los pasos en proyecto/ de un checkout ya preparado. */
export async function runChecks(
  directory: string,
  install: string[],
  steps: string[][],
  runner: CommandRunner,
  parent = '',
): Promise<Pick<CommitReport, 'status' | 'stage' | 'detail'>> {
  const cwd = join(directory, 'proyecto');
  const [installCommand, ...installArgs] = install;
  const installed = await runner(installCommand!, installArgs, { cwd });
  if (installed.code !== 0)
    return { status: 'fallo', stage: 'instalacion', detail: tail(installed.output) };
  for (const step of steps) {
    const [command, ...args] = step.map((item) => item.replaceAll('{parent}', parent));
    const result = await runner(command!, args, { cwd });
    if (result.code !== 0)
      return {
        status: 'fallo',
        stage: 'comprobacion',
        detail: `${[command, ...args].join(' ')}\n${tail(result.output)}`,
      };
  }
  return { status: 'ok' };
}

async function verifyInWorktree(
  top: string,
  sha: string,
  parent: string,
  mode: Mode,
  commands: VerifyCommands,
  runner: CommandRunner,
): Promise<Pick<CommitReport, 'status' | 'stage' | 'detail'>> {
  return withWorktree(top, sha, (directory) =>
    runChecks(
      directory,
      commands.install,
      mode === 'raiz' ? commands.full : commands.affected,
      runner,
      parent,
    ),
  );
}

export const defaultCommands: VerifyCommands = {
  message: ['pnpm', '--dir', 'proyecto', 'exec', 'commitlint', '--config', 'commitlint.config.cjs'],
  install: ['pnpm', 'install', '--frozen-lockfile'],
  full: [
    ['pnpm', 'typecheck'],
    ['pnpm', 'build'],
    ['pnpm', 'test:unit'],
  ],
  affected: [
    ['pnpm', 'exec', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
    // --force: nunca se omite un commit por una caché de Turbo (FR-002).
    ['pnpm', 'exec', 'turbo', 'run', 'typecheck', 'build', '--force', '--filter=...[{parent}]'],
    ['pnpm', 'test:unit'],
  ],
};

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: '.' },
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
      'keep-going': { type: 'boolean', default: false },
    },
  });
  if (!values.base) throw new Error('Falta --base: indica el SHA o la rama base del PR');
  const report = await verifyCommits({
    repo: resolve(values.repo!),
    base: values.base,
    head: values.head!,
    commands: defaultCommands,
    keepGoing: values['keep-going']!,
  });
  for (const item of report.commits) {
    const label = item.status === 'ok' ? 'OK   ' : 'FALLO';
    const where = item.status === 'ok' ? item.mode : `${item.stage}`;
    console.log(`${label} ${item.sha.slice(0, 7)} [${where}] ${item.subject}`);
    if (item.detail) console.log(item.detail.replace(/^/gm, '      '));
  }
  console.log(
    report.ok
      ? `\nTodos los commits (${report.commits.length}) pasan por sí solos.`
      : `\n${report.commits.filter((item) => item.status === 'fallo').length} commit(s) fallan.`,
  );
  process.exitCode = report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'No se pudo verificar el historial');
    process.exitCode = 1;
  });
}
