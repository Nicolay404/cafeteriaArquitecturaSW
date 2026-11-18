import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluarEjecuciones } from './quality-gate.js';
import type { Intento } from './quality-gate.js';

// FR-008 y caso límite del spec: un fallo intermitente NO se borra con un reintento verde.
// Cuando un workflow se reintenta (otro intento del mismo run), este control compara los jobs de
// todos los intentos: si uno falló antes y pasó después, el check agregado se bloquea y se
// conserva la causa ORIGINAL. Falla cerrado: sin API, sin permiso o con datos inválidos, no aprueba.

export interface ApiJob {
  name: string;
  conclusion: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
}

export type JobsByAttempt = Map<number, ApiJob[]>;

/** Conclusiones que cuentan como fallo. `cancelled` y `skipped` no son un fallo del control. */
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

export interface Intermitente {
  job: string;
  razones: string[];
}

export interface AnalisisIntentos {
  intermitentes: Intermitente[];
  /** Controles que siguen fallando en el último intento: ya bloquean por sí mismos. */
  fallidos: string[];
}

function cause(job: ApiJob): string | undefined {
  const step = job.steps?.find((item) => item.conclusion !== null && FAILED.has(item.conclusion));
  return step ? `paso «${step.name}»` : undefined;
}

export function analizarIntentos(
  jobsByAttempt: JobsByAttempt,
  excluir: string[],
): AnalisisIntentos {
  const porJob = new Map<string, Intento[]>();
  for (const [attempt, jobs] of jobsByAttempt) {
    for (const job of jobs) {
      if (excluir.includes(job.name) || job.conclusion === null) continue;
      const failed = FAILED.has(job.conclusion);
      if (!failed && job.conclusion !== 'success') continue;
      const intentos = porJob.get(job.name) ?? [];
      const causa = failed ? cause(job) : undefined;
      intentos.push({
        intento: attempt,
        resultado: failed ? 'fallido' : 'correcto',
        ...(causa === undefined ? {} : { causa }),
      });
      porJob.set(job.name, intentos);
    }
  }
  const resultado: AnalisisIntentos = { intermitentes: [], fallidos: [] };
  for (const [name, intentos] of [...porJob].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const evaluacion = evaluarEjecuciones(intentos);
    if (evaluacion.estado === 'intermitente')
      resultado.intermitentes.push({ job: name, razones: evaluacion.razones });
    else if (evaluacion.estado === 'fallido') resultado.fallidos.push(name);
  }
  return resultado;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGITS = /^[0-9]+$/;

export async function fetchAttemptJobs(
  repository: string,
  runId: string,
  attempt: number,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<ApiJob[]> {
  // El host es fijo y los identificadores se validaron: ningún dato externo decide a dónde se llama.
  const url = `https://api.github.com/repos/${repository}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`;
  const response = await fetcher(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`La API de GitHub respondió ${response.status}`);
  const body = (await response.json()) as { jobs?: ApiJob[] };
  return body.jobs ?? [];
}

/** Evalúa los reintentos del run actual. Devuelve el código de salida. */
export async function runCheckAttempts(
  environment: Record<string, string | undefined>,
  fetcher: typeof fetch,
  log: (line: string) => void,
): Promise<number> {
  const repository = environment['GITHUB_REPOSITORY'];
  const runId = environment['GITHUB_RUN_ID'];
  const attemptText = environment['GITHUB_RUN_ATTEMPT'];
  const token = environment['GITHUB_TOKEN'];
  const aggregate = environment['JOB_AGREGADO'];

  if (
    !repository ||
    !REPOSITORY.test(repository) ||
    !runId ||
    !DIGITS.test(runId) ||
    !attemptText ||
    !DIGITS.test(attemptText) ||
    Number(attemptText) < 1 ||
    !token ||
    !aggregate
  ) {
    log('Configuración inválida o incompleta para comparar los intentos: no se aprueba');
    return 1;
  }
  const attempt = Number(attemptText);
  if (attempt === 1) {
    log('Primer intento del run: no hay reintentos que comparar');
    return 0;
  }

  const jobs: JobsByAttempt = new Map();
  try {
    for (let current = 1; current <= attempt; current += 1)
      jobs.set(current, await fetchAttemptJobs(repository, runId, current, token, fetcher));
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'error desconocido';
    log(`No se pudieron consultar los intentos anteriores (${reason}): no se aprueba`);
    return 1;
  }

  const analisis = analizarIntentos(jobs, [aggregate]);
  for (const name of analisis.fallidos)
    log(`«${name}» sigue fallando en el último intento: lo bloquea el propio control`);
  if (analisis.intermitentes.length === 0) {
    log(`Intento ${attempt}: sin fallos intermitentes en los intentos anteriores`);
    return 0;
  }
  log('BLOQUEADO: hay controles que fallaron y pasaron al reintentar (fallo intermitente)');
  for (const item of analisis.intermitentes) log(`  - ${item.job}: ${item.razones.join(' ')}`);
  log('Investiga la causa original antes de integrar; un reintento verde no la borra.');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCheckAttempts(process.env, fetch, (line) => console.log(line)).then((code) => {
    process.exitCode = code;
  });
}
