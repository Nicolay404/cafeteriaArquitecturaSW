import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyRevert } from '../../../scripts/ci/verify-revert.js';
import type { CommandRunner } from '../../../scripts/ci/verify-commits.js';

// T054 — Constitución VII: `git revert` de cualquier commit de main debe producir un estado
// desplegable. Se comprueba en una copia desechable, sin tocar la rama actual. Las migraciones
// ya aplicadas no se deshacen con git revert: el revert conserva sus archivos.
function git(repo: string, ...args: string[]) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function commit(repo: string, message: string, files: Record<string, string | null>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(repo, path);
    if (content === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '--no-verify', '-q', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

// Comprobación mínima: un consumidor sin su proveedor es un estado no desplegable, y una
// migración 002 debe existir mientras haya código que dependa de su columna.
const script = [
  "const fs = require('node:fs');",
  "const consumer = fs.existsSync('consumer.txt') && !fs.existsSync('provider.txt');",
  "const migration = fs.existsSync('uses-detail.txt') && !fs.existsSync('infra/migrations/002_add_detail.sql');",
  'process.exit(consumer || migration ? 1 : 0);',
].join(' ');

const commands = {
  message: [process.execPath, '-e', 'process.exit(0)'],
  install: [process.execPath, '-e', 'process.exit(0)'],
  full: [[process.execPath, '-e', script]],
  affected: [[process.execPath, '-e', script]],
};

const runner: CommandRunner = async (command, args, options) => {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8' });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
};

describe('verificación de git revert', () => {
  let repo = '';
  const shas: Record<string, string> = {};

  beforeAll(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), 'cafeteria-revert-')));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'prueba@example.test');
    git(repo, 'config', 'user.name', 'Prueba');
    commit(repo, 'chore(plataforma): base', { 'proyecto/package.json': '{}\n' });
    shas.line = commit(repo, 'feat(pedidos): línea inicial', { 'proyecto/notas.txt': 'uno\n' });
    shas.independent = commit(repo, 'docs(specs): archivo independiente', {
      'proyecto/independiente.txt': 'x\n',
    });
    shas.provider = commit(repo, 'feat(catalogo): agregar proveedor', {
      'proyecto/provider.txt': 'p\n',
    });
    shas.consumer = commit(repo, 'feat(pedidos): agregar consumidor del proveedor', {
      'proyecto/consumer.txt': 'c\n',
    });
    shas.edit = commit(repo, 'fix(pedidos): editar la línea', { 'proyecto/notas.txt': 'dos\n' });
    shas.migration = commit(repo, 'feat(plataforma): expandir con una columna opcional', {
      'proyecto/infra/migrations/002_add_detail.sql':
        'ALTER TABLE platform.probe ADD COLUMN detail text;\n',
    });
    shas.dependent = commit(repo, 'feat(pedidos): usar la columna nueva', {
      'proyecto/uses-detail.txt': 'usa detail\n',
    });
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

  const verify = (sha: string, base = 'HEAD') =>
    verifyRevert({ repo, sha, base, commands, runner });

  test('revertir un commit independiente deja un estado verificable', async () => {
    const before = snapshot();
    const report = await verify(shas.independent!);
    expect(snapshot()).toEqual(before);
    expect(report).toMatchObject({ sha: shas.independent, status: 'ok', migrationsKept: false });
  });

  test('revertir un proveedor que otro commit necesita se detecta como no desplegable', async () => {
    const before = snapshot();
    const report = await verify(shas.provider!);
    expect(snapshot()).toEqual(before);
    expect(report).toMatchObject({ status: 'fallo', stage: 'comprobacion' });
  });

  test('un revert con conflicto se informa sin dejar rastro', async () => {
    const before = snapshot();
    const report = await verify(shas.line!);
    expect(snapshot()).toEqual(before);
    expect(report).toMatchObject({ status: 'fallo', stage: 'revert' });
    expect(report.detail).toMatch(/conflict/i);
  });

  test('revertir una migración conserva su archivo: se compensa con otra, no con git revert', async () => {
    // El código posterior (uses-detail.txt) sigue dependiendo de la columna: el verificador conserva
    // el archivo de la migración y el estado resultante es desplegable.
    const report = await verify(shas.migration!);
    expect(report).toMatchObject({ status: 'ok', migrationsKept: true });
  });

  test('sin conservar las migraciones el mismo revert dejaría el código sin su columna', async () => {
    const report = await verifyRevert({
      repo,
      sha: shas.migration!,
      base: 'HEAD',
      commands,
      runner,
      keepMigrations: false,
    });
    expect(report).toMatchObject({ status: 'fallo', stage: 'comprobacion', migrationsKept: false });
  });

  test('rechaza un commit que no pertenece a la base', async () => {
    git(repo, 'switch', '-q', '-c', 'lateral', shas.independent!);
    const lateral = commit(repo, 'docs(specs): solo en una rama lateral', {
      'specs-lateral.md': 'x\n',
    });
    git(repo, 'switch', '-q', 'main');
    await expect(verify(lateral)).rejects.toThrow(/base/i);
  });

  test('rechaza una referencia que no existe', async () => {
    await expect(verify('no-existe-este-commit')).rejects.toThrow();
  });
});
