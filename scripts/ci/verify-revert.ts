import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  defaultCommands,
  resolveCommit,
  run,
  runChecks,
  spawnRunner,
  withWorktree,
} from './verify-commits.js';
import type { CommandRunner, Stage, VerifyCommands } from './verify-commits.js';

// Constitución VII: `git revert` de cualquier commit de main DEBE producir un estado desplegable.
// Se comprueba en una copia desechable (git worktree) de la base, sin tocar la rama actual:
// se aplica el revert sin confirmarlo y se ejecutan instalación, tipos, build y pruebas.
//
// Las migraciones ya aplicadas NO se deshacen con git revert: si el revert borrara el archivo de
// una migración que existe en la base de datos, el runner se negaría a arrancar. Por eso, por
// defecto, se conservan los archivos de infra/migrations y el estado se corrige con una
// migración nueva (compensación). Ver specs/001-plataforma-entrega/decisions/reversibility.md.
const MIGRATIONS = 'proyecto/infra/migrations';

export interface RevertReport {
  sha: string;
  subject: string;
  status: 'ok' | 'fallo';
  stage?: Stage | 'revert';
  detail?: string;
  /** El commit tocaba migraciones y sus archivos se conservaron tras el revert. */
  migrationsKept: boolean;
}

export async function verifyRevert(options: {
  repo: string;
  sha: string;
  base?: string;
  commands: Pick<VerifyCommands, 'install' | 'full'>;
  runner?: CommandRunner;
  keepMigrations?: boolean;
}): Promise<RevertReport> {
  const runner = options.runner ?? spawnRunner;
  const top = await run(options.repo, 'rev-parse', '--show-toplevel');
  const base = await resolveCommit(top, options.base ?? 'HEAD', 'base');
  const sha = await resolveCommit(top, options.sha, 'commit');
  const ancestor = await run(top, 'merge-base', '--is-ancestor', sha, base).then(
    () => true,
    () => false,
  );
  if (!ancestor) throw new Error(`El commit ${sha.slice(0, 7)} no pertenece a la base indicada`);

  const subject = await run(top, 'show', '-s', '--format=%s', sha);
  const touched = (await run(top, 'diff-tree', '--no-commit-id', '--name-only', '-r', sha))
    .split('\n')
    .filter((file) => file.startsWith(`${MIGRATIONS}/`));
  const keep = (options.keepMigrations ?? true) && touched.length > 0;

  return withWorktree(top, base, async (directory) => {
    try {
      // Sin confirmar: solo importa el estado resultante. No necesita identidad de autor.
      await run(directory, 'revert', '--no-commit', '--no-edit', sha);
    } catch (error) {
      await run(directory, 'revert', '--abort').catch(() => undefined);
      // Duck typing: el error de child_process puede venir de otro contexto de ejecución.
      const failure = error as { stdout?: string; stderr?: string; message?: string };
      const detail =
        `${failure.stdout ?? ''}${failure.stderr ?? ''}`.trim() ||
        failure.message ||
        'git revert falló';
      return { sha, subject, status: 'fallo', stage: 'revert', detail, migrationsKept: false };
    }
    if (keep) await run(directory, 'checkout', base, '--', MIGRATIONS);
    const result = await runChecks(
      directory,
      options.commands.install,
      options.commands.full,
      runner,
    );
    return { sha, subject, ...result, migrationsKept: keep };
  });
}

async function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string', default: '.' },
      sha: { type: 'string' },
      base: { type: 'string', default: 'HEAD' },
      'sin-migraciones': { type: 'boolean', default: false },
    },
  });
  if (!values.sha) throw new Error('Falta --sha: el commit cuyo revert se verifica');
  const report = await verifyRevert({
    repo: resolve(values.repo!),
    sha: values.sha,
    base: values.base!,
    commands: defaultCommands,
    keepMigrations: !values['sin-migraciones'],
  });
  const label = report.status === 'ok' ? 'OK   ' : 'FALLO';
  console.log(`${label} revert de ${report.sha.slice(0, 7)} ${report.subject}`);
  if (report.migrationsKept)
    console.log(
      '      Se conservaron los archivos de migración: se corrigen con una migración nueva.',
    );
  if (report.detail) console.log(report.detail.replace(/^/gm, '      '));
  process.exitCode = report.status === 'ok' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'No se pudo verificar el revert');
    process.exitCode = 1;
  });
}
