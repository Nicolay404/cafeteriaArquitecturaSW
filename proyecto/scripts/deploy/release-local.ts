import { resolve } from 'node:path';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { candidateId } from '../../packages/contracts/src/candidate.js';
import type { Deployment } from '../../packages/contracts/src/deployment.js';
import { ENVIRONMENT_TYPES } from '../../packages/contracts/src/environment.js';
import type { EnvironmentType } from '../../packages/contracts/src/environment.js';
import {
  MANIFESTS_DIR,
  PHASES,
  RELEASE_DIR,
  createLocalAdapters,
  findManifest,
  readJsonList,
  writeJsonList,
} from './local-adapters.js';
import type { Phase } from './local-adapters.js';
import { release } from './release.js';
import type { Adapters, Approval } from './release.js';

// CLI de la liberación LOCAL: `pnpm release` y `pnpm release:approve`. Registra los despliegues y
// las aprobaciones en proyecto/.release/ (ignorado por Git) y devuelve 0 solo si el candidato
// llegó a «correcto». Es el ensayo local de FR-014 a FR-017; no sustituye a una plataforma real.
export interface CliDeps {
  root: string;
  now: () => string;
  adaptersFor: (environment: EnvironmentType, inject?: Phase) => Adapters;
  log: (line: string) => void;
}

const CANDIDATE = /^cand-[0-9a-f]{12}$/;
const APPROVER = /^[A-Za-z0-9-]{1,39}$/;
const USAGE =
  'Uso: pnpm release --candidate <id> --env <preview|staging|production> | pnpm release:approve --candidate <id> --approver <usuario>';

// Por forma y no con instanceof: los errores de node:util pueden venir de otro contexto de ejecución.
const messageOf = (error: unknown, fallback: string) =>
  typeof error === 'object' &&
  error !== null &&
  'message' in error &&
  typeof error.message === 'string' &&
  error.message !== ''
    ? error.message
    : fallback;

export async function runReleaseCli(args: string[], deps: CliDeps): Promise<number> {
  const { log } = deps;
  let command: string | undefined;
  let values: {
    candidate?: string | undefined;
    env?: string | undefined;
    inject?: string | undefined;
    approver?: string | undefined;
  };
  try {
    const parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        candidate: { type: 'string' },
        env: { type: 'string' },
        inject: { type: 'string' },
        approver: { type: 'string' },
      },
    });
    command = parsed.positionals[0];
    values = parsed.values;
  } catch (error) {
    log(messageOf(error, 'Argumentos no válidos'));
    return 1;
  }
  if (command !== 'release' && command !== 'approve') {
    log(`Comando desconocido o ausente. ${USAGE}`);
    return 1;
  }
  if (!values.candidate) {
    log('Falta --candidate');
    return 1;
  }
  if (!CANDIDATE.test(values.candidate)) {
    log('Identificador de candidato no válido (se espera cand-<12 hex>)');
    return 1;
  }
  const id = values.candidate;

  const stateDir = join(deps.root, RELEASE_DIR);
  const deploymentsFile = join(stateDir, 'deployments.json');
  const deployments = readJsonList<Deployment>(deploymentsFile);
  const candidate = findManifest(join(deps.root, MANIFESTS_DIR), id);
  if (!candidate) {
    log(`No existe el manifiesto del candidato ${id}: ejecuta primero pnpm candidate:package`);
    return 1;
  }
  const provenIn = [
    ...new Set(
      deployments
        .filter((item) => item.candidateId === id && item.estado === 'correcto')
        .map((item) => item.entorno),
    ),
  ];

  if (command === 'approve') {
    if (!values.approver) {
      log('Falta --approver');
      return 1;
    }
    if (!APPROVER.test(values.approver)) {
      log('Aprobador no válido (usuario de GitHub: letras, números y guiones)');
      return 1;
    }
    if (!provenIn.includes('staging')) {
      log(`El candidato ${id} no pasó por staging: no se puede aprobar para producción`);
      return 1;
    }
    const approvals = readJsonList<Approval>(join(stateDir, 'approvals.json')).filter(
      (item) => item.candidateId !== id,
    );
    approvals.push({ candidateId: id, approverId: values.approver });
    writeJsonList(stateDir, 'approvals.json', approvals);
    log(`Candidato ${id} aprobado por ${values.approver}`);
    return 0;
  }

  if (!values.env) {
    log('Falta --env');
    return 1;
  }
  if (!(ENVIRONMENT_TYPES as readonly string[]).includes(values.env)) {
    log(`Entorno no válido: se espera ${ENVIRONMENT_TYPES.join(', ')}`);
    return 1;
  }
  const environment = values.env as EnvironmentType;
  if (values.inject !== undefined && !(PHASES as readonly string[]).includes(values.inject)) {
    log(`Fase de fallo no válida: se espera ${PHASES.join(', ')}`);
    return 1;
  }

  // La versión anterior es el último despliegue CORRECTO de este entorno.
  const previous = deployments
    .filter((item) => item.entorno === environment && item.estado === 'correcto')
    .sort((a, b) => (a.end ?? '').localeCompare(b.end ?? '', 'en'))
    .at(-1);

  try {
    const result = await release({
      candidate,
      environment,
      deploymentId: `dep-${deps.now().replace(/\D/g, '').slice(0, 14)}-${deployments.length + 1}`,
      adapters: deps.adaptersFor(environment, values.inject as Phase | undefined),
      now: deps.now,
      active: deployments,
      provenIn,
      ...(previous ? { previous } : {}),
    });
    writeJsonList(stateDir, 'deployments.json', [...deployments, result.deployment]);
    const { deployment } = result;
    log(
      `Despliegue ${deployment.id} (${environment}, ${candidateId(candidate)}): ${deployment.estado}`,
    );
    log(`  estados: ${result.history.join(' → ')}`);
    log(`  pasos:   ${result.steps.join(', ') || 'ninguno'}`);
    if (deployment.cause) log(`  causa:   ${deployment.cause}`);
    if (deployment.restoredDeploymentId) log(`  restauró: ${deployment.restoredDeploymentId}`);
    return deployment.estado === 'correcto' ? 0 : 1;
  } catch (error) {
    log(messageOf(error, 'La liberación no pudo iniciarse'));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = process.cwd();
  void runReleaseCli(process.argv.slice(2), {
    root,
    now: () => new Date().toISOString(),
    adaptersFor: (environment, inject) =>
      createLocalAdapters({ environment, root, ...(inject ? { inject } : {}) }),
    log: (line) => console.log(line),
  }).then((code) => {
    process.exitCode = code;
  });
}
