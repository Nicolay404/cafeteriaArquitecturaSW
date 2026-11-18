import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildCandidate, candidateId } from '../../packages/contracts/src/candidate.js';
import { createDeployment, transition } from '../../packages/contracts/src/deployment.js';
import {
  LOCAL_ENVIRONMENTS,
  MANIFESTS_DIR,
  RELEASE_DIR,
  createLocalAdapters,
  findManifest,
  stackVariables,
} from '../../scripts/deploy/local-adapters.js';
import type { Runner } from '../../scripts/deploy/local-adapters.js';

// T061/T062 — adaptadores locales del orquestador. Docker y la red se simulan: se prueba que cada
// operación pide lo correcto (qué imágenes, en qué puertos, con qué versión) y que un fallo se
// convierte en un error. La ejecución real contra Docker se documenta en la evidencia.
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
const current = candidate('a');
const older = candidate('b');

describe('entornos locales', () => {
  it('cada entorno tiene su proyecto y sus puertos, sin solaparse', () => {
    const all = Object.values(LOCAL_ENVIRONMENTS);
    const ports = all.flatMap((item) => [item.web, item.api, item.postgres]);
    expect(new Set(ports).size).toBe(ports.length);
    expect(new Set(all.map((item) => item.project)).size).toBe(all.length);
    expect(LOCAL_ENVIRONMENTS.production.project).toBe('cafeteria-production');
  });

  it('las variables del stack llevan la versión del candidato, sus imágenes y los puertos del entorno', () => {
    const variables = stackVariables('staging', current, { api: 'a', worker: 'w', web: 'x' });
    expect(variables).toMatchObject({
      APP_ENV: 'staging',
      APP_VERSION: current.sha,
      API_IMAGE: 'a',
      WORKER_IMAGE: 'w',
      WEB_IMAGE: 'x',
      WEB_HOST_PORT: '4100',
      API_HOST_PORT: '4101',
      POSTGRES_HOST_PORT: '54100',
    });
  });
});

describe('manifiestos y aprobaciones', () => {
  let root = '';
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cafeteria-release-'));
    created.push(root);
    mkdirSync(join(root, MANIFESTS_DIR), { recursive: true });
  });

  const save = (value: ReturnType<typeof candidate>) =>
    writeFileSync(
      join(root, MANIFESTS_DIR, `${candidateId(value)}.json`),
      JSON.stringify({ id: candidateId(value), ...value }),
    );

  it('encuentra el manifiesto de un candidato por su id', () => {
    save(current);
    expect(findManifest(join(root, MANIFESTS_DIR), candidateId(current))?.sha).toBe(current.sha);
  });

  it('devuelve vacío si no existe, sin lanzar', () => {
    expect(findManifest(join(root, MANIFESTS_DIR), 'cand-000000000000')).toBeUndefined();
    expect(findManifest(join(root, 'no-existe'), 'cand-000000000000')).toBeUndefined();
  });

  it('un id con rutas no sale de la carpeta: solo se compara con los nombres que hay', () => {
    save(current);
    mkdirSync(join(root, 'otra'), { recursive: true });
    writeFileSync(join(root, 'otra', 'secreto.json'), '{"x":1}');
    for (const hostile of ['../otra/secreto', '..\\otra\\secreto', 'cand-aaaaaaaaaaaa/../..', '']) {
      expect(findManifest(join(root, MANIFESTS_DIR), hostile)).toBeUndefined();
    }
  });

  it('rechaza un manifiesto alterado: su id no corresponde a su contenido', () => {
    const id = candidateId(current);
    writeFileSync(
      join(root, MANIFESTS_DIR, `${id}.json`),
      JSON.stringify({ id, ...current, sha: 'c'.repeat(40) }),
    );
    expect(() => findManifest(join(root, MANIFESTS_DIR), id)).toThrow(/id/i);
  });

  it('la aprobación se busca por candidato: sin registro no hay aprobación', async () => {
    const adapters = createLocalAdapters({
      environment: 'production',
      root,
      run: async () => ({ code: 0, output: '' }),
    });
    expect(await adapters.approval(candidateId(current))).toBeNull();
    mkdirSync(join(root, RELEASE_DIR), { recursive: true });
    writeFileSync(
      join(root, RELEASE_DIR, 'approvals.json'),
      JSON.stringify([{ candidateId: candidateId(current), approverId: 'rafapalacios5' }]),
    );
    expect(await adapters.approval(candidateId(current))).toEqual({
      candidateId: candidateId(current),
      approverId: 'rafapalacios5',
    });
    expect(await adapters.approval(candidateId(older))).toBeNull();
  });

  it('un archivo de aprobaciones dañado equivale a no tener ninguna', async () => {
    mkdirSync(join(root, RELEASE_DIR), { recursive: true });
    writeFileSync(join(root, RELEASE_DIR, 'approvals.json'), '{no es json');
    const adapters = createLocalAdapters({
      environment: 'production',
      root,
      run: async () => ({ code: 0, output: '' }),
    });
    expect(await adapters.approval(candidateId(current))).toBeNull();
  });

  it('las alertas quedan registradas en un archivo', async () => {
    const adapters = createLocalAdapters({ environment: 'staging', root });
    await adapters.alert('prueba de alerta');
    const text = (await import('node:fs')).readFileSync(
      join(root, RELEASE_DIR, 'alerts.log'),
      'utf8',
    );
    expect(text).toMatch(/prueba de alerta/);
  });
});

describe('despliegue y smoke', () => {
  let root = '';
  let commands: Array<{ command: string; args: string[]; environment: Record<string, string> }> =
    [];
  const run: Runner = async (command, args, environment) => {
    commands.push({ command, args, environment });
    return { code: 0, output: '' };
  };
  const healthyFetch = (version: string, ok = true): typeof fetch =>
    (async (input: unknown) => {
      const url = String(input);
      const body = url.endsWith('/api/health') ? { status: 'ok', version } : { status: 'ok' };
      return { ok, status: ok ? 200 : 503, json: async () => body };
    }) as unknown as typeof fetch;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cafeteria-release-'));
    created.push(root);
    commands = [];
  });

  it('el backend etiqueta las imágenes por digest y levanta API y worker en el proyecto del entorno', async () => {
    const adapters = createLocalAdapters({ environment: 'staging', root, run });
    await adapters.deployBackend(current);
    const tags = commands.filter((item) => item.args[0] === 'tag');
    expect(tags.map((item) => item.args[1])).toEqual([
      current.digestApi,
      current.digestWorker,
      current.digestWeb,
    ]);
    const up = commands.find((item) => item.args.includes('up'))!;
    expect(up.args).toEqual(expect.arrayContaining(['-p', 'cafeteria-staging', 'api', 'worker']));
    expect(up.args).not.toContain('web');
    expect(up.environment['APP_VERSION']).toBe(current.sha);
  });

  it('la web se despliega después y por separado', async () => {
    const adapters = createLocalAdapters({ environment: 'production', root, run });
    await adapters.deployFrontend(current);
    const up = commands.find((item) => item.args.includes('up'))!;
    expect(up.args).toContain('web');
    expect(up.args).not.toContain('api');
    expect(up.args).toEqual(expect.arrayContaining(['-p', 'cafeteria-production']));
  });

  it('un fallo de Docker se convierte en un error que dice qué falló', async () => {
    const failing: Runner = async () => ({ code: 1, output: 'sin espacio en disco' });
    const adapters = createLocalAdapters({ environment: 'staging', root, run: failing });
    await expect(adapters.deployBackend(current)).rejects.toThrow(/sin espacio/);
  });

  it('el smoke pasa solo si la web, el proxy y la API responden con la versión del candidato', async () => {
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      fetcher: healthyFetch(current.sha),
      retryDelayMs: 1,
    });
    expect(await adapters.smoke(current)).toBe(true);
  });

  it('el smoke falla si responde otra versión, aunque todo esté sano', async () => {
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      fetcher: healthyFetch(older.sha),
      retryDelayMs: 1,
    });
    expect(await adapters.smoke(current)).toBe(false);
  });

  it('el smoke falla si algún endpoint no responde bien', async () => {
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      fetcher: healthyFetch(current.sha, false),
      retryDelayMs: 1,
    });
    expect(await adapters.smoke(current)).toBe(false);
  });

  it('el smoke falla si no hay respuesta, tras reintentar', async () => {
    let attempts = 0;
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      retryDelayMs: 1,
      fetcher: (async () => {
        attempts += 1;
        throw new Error('conexión rechazada');
      }) as unknown as typeof fetch,
    });
    expect(await adapters.smoke(current)).toBe(false);
    expect(attempts).toBeGreaterThan(3);
  });

  it('restaurar vuelve a desplegar el candidato anterior y lo verifica con SU versión', async () => {
    mkdirSync(join(root, MANIFESTS_DIR), { recursive: true });
    writeFileSync(
      join(root, MANIFESTS_DIR, `${candidateId(older)}.json`),
      JSON.stringify({ id: candidateId(older), ...older }),
    );
    let previous = createDeployment({
      id: 'dep-0',
      candidateId: candidateId(older),
      entorno: 'staging',
      start: '2026-11-17T09:00:00.000Z',
    });
    for (const [index, state] of (
      ['migrando', 'backend_listo', 'frontend_listo', 'verificando', 'correcto'] as const
    ).entries())
      previous = transition(previous, state, {
        at: `2026-11-17T09:0${index + 1}:00.000Z`,
        ...(state === 'correcto' ? { smokePassed: true } : {}),
      });
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      fetcher: healthyFetch(older.sha),
      retryDelayMs: 1,
    });
    expect(await adapters.restore(previous)).toBe(true);
    const tags = commands.filter((item) => item.args[0] === 'tag');
    expect(tags[0]!.args[1]).toBe(older.digestApi);
    expect(commands.some((item) => item.args.includes('web'))).toBe(true);
  });

  it('restaurar falla de forma controlada si el manifiesto anterior no existe', async () => {
    const orphan = createDeployment({
      id: 'dep-0',
      candidateId: 'cand-123456789abc',
      entorno: 'staging',
      start: '2026-11-17T09:00:00.000Z',
    });
    const adapters = createLocalAdapters({ environment: 'staging', root, run });
    await expect(adapters.restore(orphan)).rejects.toThrow(/manifiesto/i);
  });
});

describe('migraciones del candidato', () => {
  it('no migra si las migraciones del repositorio no coinciden con las del candidato', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cafeteria-release-'));
    created.push(root);
    const migrations = join(root, 'infra/migrations');
    mkdirSync(migrations, { recursive: true });
    writeFileSync(join(migrations, '001_extra.sql'), 'SELECT 1;');
    const commands: string[][] = [];
    const run: Runner = async (_command, args) => {
      commands.push(args);
      return { code: 0, output: '' };
    };
    const adapters = createLocalAdapters({ environment: 'staging', root, run });
    // El candidato declara cero migraciones; el repositorio tiene una: no coinciden.
    await expect(adapters.migrate(current)).rejects.toThrow(/no coinciden/i);
    expect(commands).toEqual([]);
  });
});

describe('fallos inyectados para ensayar el rollback', () => {
  it.each([
    ['migrate', 'migrate'],
    ['backend', 'deployBackend'],
    ['web', 'deployFrontend'],
    ['smoke', 'smoke'],
  ] as const)('la fase «%s» falla a propósito cuando se pide', async (phase, key) => {
    const root = mkdtempSync(join(tmpdir(), 'cafeteria-release-'));
    created.push(root);
    const run: Runner = async () => ({ code: 0, output: '' });
    const adapters = createLocalAdapters({
      environment: 'staging',
      root,
      run,
      inject: phase,
      retryDelayMs: 1,
    });
    await expect(adapters[key](current)).rejects.toThrow(/inyectado/i);
  });

  it('sin inyección no falla por sí sola', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cafeteria-release-'));
    created.push(root);
    const run: Runner = async () => ({ code: 0, output: '' });
    const adapters = createLocalAdapters({ environment: 'staging', root, run });
    await expect(adapters.deployFrontend(current)).resolves.toBeUndefined();
  });
});
