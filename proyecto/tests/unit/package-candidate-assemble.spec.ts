import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { candidateId, parseCandidate } from '../../packages/contracts/src/candidate.js';
import { packageCandidate } from '../../scripts/ci/package-candidate.js';
import type { DockerRunner } from '../../scripts/ci/package-candidate.js';

// T042 — el candidato se arma desde un checkout LIMPIO del commit indicado: lo que se etiqueta con
// un SHA tiene que ser exactamente lo que se construyó. Docker se simula; la prueba comprueba el
// orden, las rutas, la identidad por contenido y que nunca se use el árbol de trabajo.
const sha = 'a'.repeat(40);
const created: string[] = [];
afterAll(() => {
  for (const directory of created) rmSync(directory, { recursive: true, force: true });
});

function temp(prefix: string) {
  const path = mkdtempSync(join(tmpdir(), prefix));
  created.push(path);
  return path;
}

describe('packageCandidate', () => {
  let context = '';
  let out = '';
  let calls: string[][] = [];
  let cleaned = 0;

  /** Docker simulado: devuelve un id por imagen y «copia» un .next determinista en `cp`. */
  const docker =
    (
      webFiles: Record<string, string> = { 'server/app.js': 'codigo', BUILD_ID: 'x' },
    ): DockerRunner =>
    async (args) => {
      calls.push(args);
      const [command] = args;
      if (command === 'image') {
        const tag = args[args.length - 1]!;
        const fill = tag.includes('worker') ? '2' : tag.includes('web') ? '3' : '1';
        return { code: 0, stdout: `sha256:${fill.repeat(64)}\n` };
      }
      if (command === 'create') return { code: 0, stdout: 'contenedor-temporal\n' };
      if (command === 'cp') {
        const destination = args[args.length - 1]!;
        for (const [name, content] of Object.entries(webFiles)) {
          const file = join(destination, name);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, content);
        }
        return { code: 0, stdout: '' };
      }
      return { code: 0, stdout: '' };
    };

  const run = (overrides: Partial<Parameters<typeof packageCandidate>[0]> = {}) =>
    packageCandidate({
      sha,
      docker: docker(),
      outDir: out,
      reportRefs: ['https://github.com/Nicolay404/cafeteriaArquitecturaSW/actions/runs/1'],
      configRevision: 'rev-local-1',
      prepare: async () => ({
        directory: context,
        cleanup: async () => {
          cleaned += 1;
        },
      }),
      ...overrides,
    });

  beforeEach(() => {
    context = temp('cafeteria-ctx-');
    out = temp('cafeteria-out-');
    calls = [];
    cleaned = 0;
    mkdirSync(join(context, 'proyecto/infra/migrations'), { recursive: true });
    writeFileSync(join(context, 'proyecto/infra/migrations/001_probe.sql'), 'SELECT 1;');
  });

  it('construye las tres imágenes desde el checkout limpio y no desde otro directorio', async () => {
    await run();
    const builds = calls.filter((args) => args[0] === 'build');
    expect(builds).toHaveLength(3);
    for (const [index, app] of ['api', 'worker', 'web'].entries()) {
      expect(builds[index]).toContain(`apps/${app}/Dockerfile`);
      expect(builds[index]).toContain(join(context, 'proyecto'));
      expect(builds[index]).toContain(`cafeteria-${app}:${sha.slice(0, 12)}`);
    }
  });

  it('el manifiesto lleva los digests de las imágenes, el hash de la web y los checksums de las migraciones', async () => {
    const { candidate } = await run();
    expect(candidate.sha).toBe(sha);
    expect(candidate.digestApi).toBe(`sha256:${'1'.repeat(64)}`);
    expect(candidate.digestWorker).toBe(`sha256:${'2'.repeat(64)}`);
    expect(candidate.hashWeb).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(candidate.migrationChecksums['001']).toMatch(/^[0-9a-f]{64}$/);
    expect(candidate.configRevision).toBe('rev-local-1');
  });

  it('escribe un manifiesto que se vuelve a leer y cuyo id coincide con su contenido', async () => {
    const { candidate, id, path } = await run();
    expect(path).toBe(join(out, `${id}.json`));
    const read = parseCandidate(JSON.parse(readFileSync(path, 'utf8')));
    expect(candidateId(read)).toBe(id);
    expect(candidateId(candidate)).toBe(id);
  });

  it('el mismo contenido da el mismo candidato; otro contenido de la web, otro candidato', async () => {
    const one = await run();
    const two = await run();
    expect(two.id).toBe(one.id);
    const other = await run({
      docker: docker({ 'server/app.js': 'codigo distinto', BUILD_ID: 'x' }),
    });
    expect(other.id).not.toBe(one.id);
  });

  it('un cambio en una migración cambia el candidato', async () => {
    const before = await run();
    writeFileSync(join(context, 'proyecto/infra/migrations/002_nueva.sql'), 'SELECT 2;');
    expect((await run()).id).not.toBe(before.id);
  });

  it('descarta las cachés de ejecución al calcular el hash de la web', async () => {
    const base = await run();
    const withCache = await run({
      docker: docker({
        'server/app.js': 'codigo',
        BUILD_ID: 'x',
        'cache/ruido.bin': 'r',
        'server/route-cache/x.html': 'r',
      }),
    });
    expect(withCache.candidate.hashWeb).toBe(base.candidate.hashWeb);
  });

  it('limpia el contenedor temporal y el checkout aunque algo falle', async () => {
    await run();
    expect(cleaned).toBe(1);
    expect(calls.filter((args) => args[0] === 'rm')).toHaveLength(1);

    cleaned = 0;
    const failing: DockerRunner = async (args) =>
      args[0] === 'build' && args.includes('apps/worker/Dockerfile')
        ? { code: 1, stdout: '' }
        : docker()(args);
    await expect(run({ docker: failing })).rejects.toThrow(/worker/);
    expect(cleaned).toBe(1);
  });

  it.each([
    ['SHA que no es completo', { sha: 'abc123' }],
    ['SHA con mayúsculas', { sha: 'A'.repeat(40) }],
    ['informe que no es https', { reportRefs: ['file:///etc/passwd'] }],
    [
      'revisión que parece un secreto',
      { configRevision: 'ghp_' + 'aB3dE5gH7jK9mN2pQ4rS6tV8wX0yZ1cF3hJ5' },
    ],
  ])('rechaza %s antes de ejecutar Docker', async (_nombre, overrides) => {
    await expect(run(overrides)).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('falla si Docker no devuelve un digest válido en lugar de aceptar un tag', async () => {
    const wrong: DockerRunner = async (args) =>
      args[0] === 'image' ? { code: 0, stdout: 'cafeteria-api:latest\n' } : docker()(args);
    await expect(run({ docker: wrong })).rejects.toThrow(/digest/i);
  });
});
