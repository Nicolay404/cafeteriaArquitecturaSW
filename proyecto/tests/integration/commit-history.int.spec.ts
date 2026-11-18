import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCommits } from '../../../scripts/ci/verify-commits.js';
import type { CommandRunner, VerifyCommands } from '../../../scripts/ci/verify-commits.js';

// T023/T026 — FR-002: cada commit del PR se verifica por separado, no solo la cabeza.
// Repositorios temporales reales y comprobaciones mínimas: lo que se prueba es el recorrido
// del historial, no pnpm. El repositorio actual nunca se modifica.
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const commitlintCli = join(workspace, 'node_modules/@commitlint/cli/cli.js');
const commitlintConfig = join(workspace, 'commitlint.config.cjs');

function git(repo: string, ...args: string[]) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function commit(repo: string, message: string, files: Record<string, string | null> = {}) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(repo, path);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--no-verify', '-q', '--allow-empty', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

// La comprobación de cada etapa falla si existe proyecto/BROKEN en el checkout verificado.
const check = (stage: string) => [
  process.execPath,
  '-e',
  "process.exit(require('node:fs').existsSync('BROKEN') ? 1 : 0)",
  '--',
  `--stage=${stage}`,
];

function harness(log: string[]): { commands: VerifyCommands; runner: CommandRunner } {
  return {
    commands: {
      message: [process.execPath, commitlintCli, '--config', commitlintConfig],
      install: [process.execPath, '-e', 'process.exit(0)', '--', '--stage=install'],
      full: [check('full')],
      affected: [check('affected:{parent}')],
    },
    runner: async (command, args, options) => {
      log.push(args.find((item) => item.startsWith('--stage=')) ?? 'commitlint');
      const result = spawnSync(command, args, {
        cwd: options.cwd,
        input: options.input,
        encoding: 'utf8',
      });
      return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
    },
  };
}

describe('verificación commit a commit', () => {
  let repo = '';
  let base = '';
  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'cafeteria-history-')));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'prueba@example.test');
    git(repo, 'config', 'user.name', 'Prueba');
    base = commit(repo, 'chore(plataforma): crear el repositorio de prueba', {
      'proyecto/package.json': '{"name":"fixture"}\n',
      'proyecto/apps/api/src/index.ts': 'export const a = 1;\n',
    });
    git(repo, 'switch', '-q', '-c', 'feature/spec-prueba');
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  const snapshot = () => ({
    head: git(repo, 'rev-parse', 'HEAD'),
    branch: git(repo, 'branch', '--show-current'),
    status: git(repo, 'status', '--porcelain'),
    worktrees: git(repo, 'worktree', 'list', '--porcelain'),
  });

  function verify(options: { from?: string; to?: string; keepGoing?: boolean; log?: string[] }) {
    const { commands, runner } = harness(options.log ?? []);
    return verifyCommits({
      repo,
      base: options.from ?? base,
      head: options.to ?? 'HEAD',
      commands,
      runner,
      keepGoing: options.keepGoing ?? false,
    });
  }

  test('un PR correcto pasa y cada commit usa el modo que le corresponde', async () => {
    const docs = commit(repo, 'docs(specs): anotar una decisión', { 'specs/001/notas.md': '#\n' });
    const app = commit(repo, 'feat(pedidos): ampliar la API', {
      'proyecto/apps/api/src/index.ts': 'export const a = 2;\n',
    });
    const root = commit(repo, 'build(deps): fijar la versión', {
      'proyecto/package.json': '{"name":"fixture","version":"1"}\n',
    });
    const log: string[] = [];
    const before = snapshot();
    const report = await verify({ log });

    expect(snapshot()).toEqual(before);
    expect(report.ok).toBe(true);
    expect(report.commits.map((item) => [item.sha, item.mode, item.status])).toEqual([
      [docs, 'documentacion', 'ok'],
      [app, 'aplicacion', 'ok'],
      [root, 'raiz', 'ok'],
    ]);
    // Documentación: solo el mensaje. Aplicación: afectados desde el padre. Raíz: todo.
    expect(log.filter((item) => item === 'commitlint')).toHaveLength(3);
    expect(log.filter((item) => item === '--stage=install')).toHaveLength(2);
    expect(log.filter((item) => item.startsWith('--stage=affected'))).toEqual([
      `--stage=affected:${docs}`,
    ]);
    expect(log.filter((item) => item === '--stage=full')).toHaveLength(1);
  });

  test('un commit intermedio roto se detecta con su SHA aunque la cabeza esté verde', async () => {
    const start = git(repo, 'rev-parse', 'HEAD');
    const broken = commit(repo, 'feat(pedidos): introducir un fallo temporal', {
      'proyecto/BROKEN': 'x\n',
    });
    const fixed = commit(repo, 'fix(pedidos): corregir el fallo temporal', {
      'proyecto/BROKEN': null,
    });

    // La cabeza, por sí sola, está verde...
    expect((await verify({ from: broken, to: fixed })).ok).toBe(true);

    // ...pero el recorrido completo señala el commit intermedio y se detiene en él.
    const before = snapshot();
    const report = await verify({ from: start });
    expect(snapshot()).toEqual(before);
    expect(report.ok).toBe(false);
    expect(report.commits.map((item) => item.status)).toEqual(['fallo']);
    expect(report.commits[0]).toMatchObject({ sha: broken, stage: 'comprobacion' });

    const complete = await verify({ from: start, keepGoing: true });
    expect(complete.commits.map((item) => item.status)).toEqual(['fallo', 'ok']);
    expect(complete.commits[1]?.sha).toBe(fixed);
  });

  test('un mensaje inválido falla en la etapa de mensaje, antes de instalar nada', async () => {
    const start = git(repo, 'rev-parse', 'HEAD');
    const invalid = commit(repo, 'arreglos varios', {
      'proyecto/apps/api/src/index.ts': 'export const a = 4;\n',
    });
    const log: string[] = [];
    const report = await verify({ from: start, log });
    expect(report.ok).toBe(false);
    expect(report.commits).toHaveLength(1);
    expect(report.commits[0]).toMatchObject({ sha: invalid, status: 'fallo', stage: 'mensaje' });
    expect(log).toEqual(['commitlint']);
  });

  test('un historial con merges no es lineal y se rechaza', async () => {
    const start = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'switch', '-q', '-c', 'lateral', start);
    commit(repo, 'docs(specs): cambio lateral', { 'specs/lateral.md': 'x\n' });
    git(repo, 'switch', '-q', 'feature/spec-prueba');
    commit(repo, 'docs(specs): cambio principal', { 'specs/principal.md': 'x\n' });
    git(repo, 'merge', '--no-ff', '--no-verify', '-q', '-m', 'Merge lateral', 'lateral');
    const report = await verify({ from: start });
    expect(report.ok).toBe(false);
    expect(report.commits.some((item) => item.stage === 'historial')).toBe(true);
  });

  test('rechaza una base que no existe sin tocar el repositorio', async () => {
    const before = snapshot();
    await expect(verify({ from: 'no-existe-esta-rama' })).rejects.toThrow('base');
    expect(snapshot()).toEqual(before);
  });
});
