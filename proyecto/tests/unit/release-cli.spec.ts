import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildCandidate, candidateId } from '../../packages/contracts/src/candidate.js';
import { MANIFESTS_DIR, RELEASE_DIR } from '../../scripts/deploy/local-adapters.js';
import type { Phase } from '../../scripts/deploy/local-adapters.js';
import { runReleaseCli } from '../../scripts/deploy/release-local.js';
import type { Adapters } from '../../scripts/deploy/release.js';

// T061/T062 — el CLI de liberación local: valida sus argumentos, registra los despliegues y las
// aprobaciones, y devuelve un código de salida que dice si el candidato llegó a «correcto».
const created: string[] = [];
afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

const candidate = (fill: string) =>
  buildCandidate({
    sha: fill.repeat(40),
    digestApi: `sha256:${fill.repeat(64)}`,
    digestWorker: `sha256:${fill.repeat(64)}`,
    digestWeb: `sha256:${fill.repeat(64)}`,
    hashWeb: `sha256:${fill.repeat(64)}`,
    migrationChecksums: {},
    configRevision: 'rev',
    reportRefs: [],
  });
const first = candidate('a');
const second = candidate('b');
const firstId = candidateId(first);
const secondId = candidateId(second);

describe('CLI de liberación local', () => {
  let root = '';
  let lines: string[] = [];
  let calls: string[] = [];
  let injected: Phase | undefined;
  let smokeResult = true;

  const adaptersFor = (): Adapters => ({
    approval: async (id) => {
      const approvals = JSON.parse(
        readFileSync(join(root, RELEASE_DIR, 'approvals.json'), 'utf8'),
      ) as Array<{ candidateId: string; approverId: string }>;
      return approvals.find((item) => item.candidateId === id) ?? null;
    },
    migrate: async () => void calls.push('migrar'),
    deployBackend: async () => void calls.push('backend'),
    deployFrontend: async () => void calls.push('web'),
    smoke: async () => smokeResult,
    restore: async () => {
      calls.push('restaurar');
      return true;
    },
    alert: async (message) => void lines.push(`ALERTA ${message}`),
  });

  const run = (...args: string[]) => {
    lines = [];
    return runReleaseCli(args, {
      root,
      now: (() => {
        let minute = 0;
        return () => `2026-11-18T12:${String(minute++ % 60).padStart(2, '0')}:00.000Z`;
      })(),
      adaptersFor: (_environment, inject) => {
        injected = inject;
        return adaptersFor();
      },
      log: (line) => lines.push(line),
    });
  };

  const deployments = () =>
    JSON.parse(readFileSync(join(root, RELEASE_DIR, 'deployments.json'), 'utf8')) as Array<{
      candidateId: string;
      entorno: string;
      estado: string;
    }>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cafeteria-cli-'));
    created.push(root);
    mkdirSync(join(root, MANIFESTS_DIR), { recursive: true });
    for (const item of [first, second])
      writeFileSync(
        join(root, MANIFESTS_DIR, `${candidateId(item)}.json`),
        JSON.stringify({ id: candidateId(item), ...item }),
      );
    calls = [];
    injected = undefined;
    smokeResult = true;
  });

  it('libera a staging, registra el despliegue y sale con 0', async () => {
    expect(await run('release', '--candidate', firstId, '--env', 'staging')).toBe(0);
    expect(calls).toEqual(['migrar', 'backend', 'web']);
    expect(deployments()).toMatchObject([
      { candidateId: firstId, entorno: 'staging', estado: 'correcto' },
    ]);
    expect(lines.join('\n')).toMatch(/correcto/);
  });

  it('producción sin haber pasado por staging se rechaza sin tocar nada', async () => {
    expect(await run('release', '--candidate', firstId, '--env', 'production')).toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join('\n')).toMatch(/staging/);
  });

  it('producción sin aprobación falla y lo deja registrado; con ella, llega a correcto', async () => {
    await run('release', '--candidate', firstId, '--env', 'staging');
    mkdirSync(join(root, RELEASE_DIR), { recursive: true });
    writeFileSync(join(root, RELEASE_DIR, 'approvals.json'), '[]');
    expect(await run('release', '--candidate', firstId, '--env', 'production')).toBe(1);
    expect(deployments().at(-1)).toMatchObject({ entorno: 'production', estado: 'fallido' });

    expect(await run('approve', '--candidate', firstId, '--approver', 'rafapalacios5')).toBe(0);
    expect(await run('release', '--candidate', firstId, '--env', 'production')).toBe(0);
    expect(deployments().at(-1)).toMatchObject({ entorno: 'production', estado: 'correcto' });
  });

  it('no se puede aprobar un candidato que no pasó por staging ni uno desconocido', async () => {
    expect(await run('approve', '--candidate', firstId, '--approver', 'rafapalacios5')).toBe(1);
    expect(lines.join('\n')).toMatch(/staging/);
    expect(await run('approve', '--candidate', 'cand-000000000000', '--approver', 'x')).toBe(1);
    expect(lines.join('\n')).toMatch(/manifiesto/i);
  });

  it('un smoke fallido revierte al despliegue anterior y sale con 1', async () => {
    await run('release', '--candidate', firstId, '--env', 'staging');
    smokeResult = false;
    expect(await run('release', '--candidate', secondId, '--env', 'staging')).toBe(1);
    expect(calls.at(-1)).toBe('restaurar');
    expect(deployments().at(-1)).toMatchObject({ candidateId: secondId, estado: 'revertido' });
  });

  it('pasa la fase a inyectar solo cuando se pide y la valida', async () => {
    await run('release', '--candidate', firstId, '--env', 'staging');
    expect(injected).toBeUndefined();
    await run('release', '--candidate', secondId, '--env', 'staging', '--inject', 'smoke');
    expect(injected).toBe('smoke');
    expect(
      await run('release', '--candidate', secondId, '--env', 'staging', '--inject', 'inventada'),
    ).toBe(1);
    expect(lines.join('\n')).toMatch(/fase/i);
  });

  it('rechaza una liberación mientras otra de producción sigue en curso', async () => {
    await run('release', '--candidate', firstId, '--env', 'staging');
    await run('approve', '--candidate', firstId, '--approver', 'rafapalacios5');
    writeFileSync(
      join(root, RELEASE_DIR, 'deployments.json'),
      JSON.stringify([
        {
          id: 'dep-x',
          candidateId: secondId,
          entorno: 'production',
          estado: 'migrando',
          start: '2026-11-18T11:00:00.000Z',
          updatedAt: '2026-11-18T11:01:00.000Z',
        },
      ]),
    );
    expect(await run('release', '--candidate', firstId, '--env', 'production')).toBe(1);
    expect(lines.join('\n')).toMatch(/simult/i);
    expect(calls.filter((call) => call === 'migrar')).toHaveLength(1);
  });

  it.each([
    [['release'], /--candidate/],
    [['release', '--candidate', firstId], /--env/],
    [['release', '--candidate', firstId, '--env', 'qa'], /entorno/i],
    [['release', '--candidate', '../../x', '--env', 'staging'], /candidato/i],
    [['approve', '--candidate', firstId], /--approver/],
    [['approve', '--candidate', firstId, '--approver', 'con espacios'], /aprobador/i],
    [['otra-cosa'], /uso|comando/i],
    [[], /uso|comando/i],
    [['release', '--candidate', firstId, '--env', 'staging', '--sorpresa'], /sorpresa/],
  ])('un uso incorrecto %j explica el error y sale con 1', async (args, pattern) => {
    expect(await run(...(args as string[]))).toBe(1);
    expect(lines.join('\n')).toMatch(pattern);
    expect(calls).toEqual([]);
  });

  it('un candidato sin manifiesto no se libera', async () => {
    expect(await run('release', '--candidate', 'cand-ffffffffffff', '--env', 'staging')).toBe(1);
    expect(lines.join('\n')).toMatch(/manifiesto/i);
  });
});
