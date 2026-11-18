import { describe, expect, it } from 'vitest';
import {
  analizarIntentos,
  fetchAttemptJobs,
  runCheckAttempts,
} from '../../scripts/ci/check-attempts.js';
import type { ApiJob } from '../../scripts/ci/check-attempts.js';

// US1 / FR-008 — un fallo intermitente no se borra con un reintento verde. El check agregado
// compara los intentos del mismo run: si un control falló en un intento anterior y pasó después,
// el PR se bloquea y se conserva la causa ORIGINAL. Datos con la forma real de la API de Actions.
const job = (name: string, conclusion: string | null, failedStep?: string): ApiJob => ({
  name,
  conclusion,
  steps: [
    { name: 'Set up job', conclusion: 'success' },
    ...(failedStep ? [{ name: failedStep, conclusion: 'failure' }] : []),
  ],
});

const env = (overrides: Record<string, string | undefined> = {}) => ({
  GITHUB_REPOSITORY: 'Nicolay404/cafeteriaArquitecturaSW',
  GITHUB_RUN_ID: '4242',
  GITHUB_RUN_ATTEMPT: '2',
  GITHUB_TOKEN: 'token-de-prueba',
  JOB_AGREGADO: 'Calidad del PR',
  ...overrides,
});

/** Un fetch simulado: la clave es el número de intento y devuelve sus jobs. */
function fakeFetch(attempts: Record<number, ApiJob[]>, status = 200) {
  const calls: string[] = [];
  const fetcher = (async (input: unknown, init?: { headers?: Record<string, string> }) => {
    const url = String(input);
    calls.push(url);
    const attempt = Number(/attempts\/(\d+)\/jobs/.exec(url)?.[1]);
    const body = status === 200 ? { jobs: attempts[attempt] ?? [] } : { message: 'denegado' };
    expect(init?.headers?.['Authorization']).toBe('Bearer token-de-prueba');
    return { ok: status === 200, status, json: async () => body };
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

const run = async (
  attempts: Record<number, ApiJob[]>,
  overrides: Record<string, string | undefined> = {},
  status = 200,
) => {
  const { fetcher, calls } = fakeFetch(attempts, status);
  const lines: string[] = [];
  const code = await runCheckAttempts(env(overrides), fetcher, (line) => lines.push(line));
  return { code, text: lines.join('\n'), calls };
};

describe('analizarIntentos', () => {
  it('un control que falló y luego pasó es intermitente, con su causa original', () => {
    const resultado = analizarIntentos(
      new Map([
        [1, [job('Lint, tipos, pruebas y build', 'failure', 'Run pnpm test:integration')]],
        [2, [job('Lint, tipos, pruebas y build', 'success')]],
      ]),
      ['Calidad del PR'],
    );
    expect(resultado.intermitentes).toHaveLength(1);
    expect(resultado.intermitentes[0]).toMatchObject({ job: 'Lint, tipos, pruebas y build' });
    expect(resultado.intermitentes[0]!.razones.join(' ')).toMatch(
      /intermitente.*intento 1.*Run pnpm test:integration/i,
    );
  });

  it('todo verde en todos los intentos no es intermitente', () => {
    const resultado = analizarIntentos(
      new Map([
        [1, [job('A', 'success'), job('B', 'success')]],
        [2, [job('A', 'success'), job('B', 'success')]],
      ]),
      [],
    );
    expect(resultado.intermitentes).toEqual([]);
    expect(resultado.fallidos).toEqual([]);
  });

  it('un control que sigue fallando en el último intento es un fallo normal, no intermitente', () => {
    const resultado = analizarIntentos(
      new Map([
        [1, [job('A', 'failure', 'paso 1')]],
        [2, [job('A', 'failure', 'paso 1')]],
      ]),
      [],
    );
    expect(resultado.intermitentes).toEqual([]);
    expect(resultado.fallidos).toEqual(['A']);
  });

  it('ignora el propio job agregado, los cancelados y los omitidos', () => {
    const resultado = analizarIntentos(
      new Map([
        [1, [job('Calidad del PR', 'failure'), job('B', 'cancelled'), job('C', 'skipped')]],
        [2, [job('Calidad del PR', 'success'), job('B', 'success'), job('C', 'success')]],
      ]),
      ['Calidad del PR'],
    );
    expect(resultado.intermitentes).toEqual([]);
  });

  it('trata el tiempo agotado y el fallo de arranque como fallos', () => {
    for (const conclusion of ['timed_out', 'startup_failure']) {
      const resultado = analizarIntentos(
        new Map([
          [1, [job('A', conclusion)]],
          [2, [job('A', 'success')]],
        ]),
        [],
      );
      expect(resultado.intermitentes).toHaveLength(1);
    }
  });

  it('informa varios controles intermitentes y la causa sin paso fallido', () => {
    const resultado = analizarIntentos(
      new Map([
        [1, [job('A', 'failure', 'paso A'), job('B', 'failure')]],
        [2, [job('A', 'success'), job('B', 'success')]],
        [3, [job('A', 'success'), job('B', 'success')]],
      ]),
      [],
    );
    expect(resultado.intermitentes.map((item) => item.job).sort()).toEqual(['A', 'B']);
    expect(resultado.intermitentes.find((item) => item.job === 'B')!.razones.join(' ')).toMatch(
      /sin causa/,
    );
  });
});

describe('fetchAttemptJobs', () => {
  it('pide los jobs del intento al host fijo de GitHub con el token', async () => {
    const { fetcher, calls } = fakeFetch({ 3: [job('A', 'success')] });
    const jobs = await fetchAttemptJobs(
      'Nicolay404/cafeteriaArquitecturaSW',
      '4242',
      3,
      'token-de-prueba',
      fetcher,
    );
    expect(jobs).toEqual([job('A', 'success')]);
    expect(calls).toEqual([
      'https://api.github.com/repos/Nicolay404/cafeteriaArquitecturaSW/actions/runs/4242/attempts/3/jobs?per_page=100',
    ]);
  });

  it('una respuesta que no es correcta falla en lugar de devolver una lista vacía', async () => {
    const { fetcher } = fakeFetch({}, 403);
    await expect(
      fetchAttemptJobs('Nicolay404/cafeteriaArquitecturaSW', '4242', 1, 'token-de-prueba', fetcher),
    ).rejects.toThrow(/403/);
  });
});

describe('runCheckAttempts', () => {
  it('en el primer intento no hay nada que comparar y no consulta la API', async () => {
    const { code, text, calls } = await run({}, { GITHUB_RUN_ATTEMPT: '1' });
    expect(code).toBe(0);
    expect(text).toMatch(/primer intento/i);
    expect(calls).toEqual([]);
  });

  it('bloquea un reintento verde que ocultaba un fallo anterior y muestra la causa original', async () => {
    const { code, text, calls } = await run({
      1: [job('Calidad del PR', 'failure'), job('Pruebas', 'failure', 'Run pnpm test:integration')],
      2: [job('Calidad del PR', 'success'), job('Pruebas', 'success')],
    });
    expect(code).toBe(1);
    expect(text).toContain('Pruebas');
    expect(text).toMatch(/intento 1.*Run pnpm test:integration/);
    expect(text).toMatch(/BLOQUEADO/);
    expect(calls).toHaveLength(2);
  });

  it('aprueba un reintento cuando ningún control había fallado antes', async () => {
    const { code, text } = await run({
      1: [job('Pruebas', 'success')],
      2: [job('Pruebas', 'success')],
    });
    expect(code).toBe(0);
    expect(text).toMatch(/sin fallos intermitentes/i);
  });

  it('un fallo que persiste no se declara intermitente (ya lo bloquea el propio control)', async () => {
    const { code, text } = await run({
      1: [job('Pruebas', 'failure', 'paso')],
      2: [job('Pruebas', 'failure', 'paso')],
    });
    expect(code).toBe(0);
    expect(text).toMatch(/Pruebas/);
    expect(text).not.toMatch(/BLOQUEADO/);
  });

  it('falla cerrado si la API no responde o no hay permiso', async () => {
    const { code, text } = await run({}, {}, 403);
    expect(code).toBe(1);
    expect(text).toMatch(/403/);
    expect(text).toMatch(/no se pudieron/i);
  });

  it.each([
    ['sin token', { GITHUB_TOKEN: undefined }],
    ['repositorio con forma inválida', { GITHUB_REPOSITORY: '../../otro' }],
    ['identificador de run no numérico', { GITHUB_RUN_ID: '12;rm' }],
    ['intento que no es un número', { GITHUB_RUN_ATTEMPT: 'dos' }],
    ['intento cero', { GITHUB_RUN_ATTEMPT: '0' }],
    ['sin nombre del job agregado', { JOB_AGREGADO: undefined }],
  ])('falla cerrado con la configuración incorrecta: %s', async (_nombre, overrides) => {
    const { code, text, calls } = await run({}, overrides as Record<string, string | undefined>);
    expect(code).toBe(1);
    expect(text).toMatch(/configuración|inválid|falta/i);
    expect(calls).toEqual([]);
  });
});
