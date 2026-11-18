import { ENVIRONMENT_TYPES } from './environment.js';
import type { EnvironmentType } from './environment.js';
import { assertKnownFields, isRecord } from './secrets.js';

// Despliegue (data-model.md): un candidato llevado a un entorno. Sus estados siguen un único
// camino válido: preparado → [esperando_aprobación, solo producción] → migrando → backend_listo →
// frontend_listo → verificando → correcto. Un fallo antes de activar conserva la versión anterior;
// un fallo después se revierte y queda enlazado al despliegue restaurado. NUNCA se marca
// «correcto» antes del smoke.
export const DEPLOYMENT_STATES = [
  'preparado',
  'esperando_aprobacion',
  'migrando',
  'backend_listo',
  'frontend_listo',
  'verificando',
  'correcto',
  'fallido',
  'revirtiendo',
  'revertido',
  'fallo_de_restauracion',
] as const;
export type DeploymentState = (typeof DEPLOYMENT_STATES)[number];

const TERMINAL: readonly DeploymentState[] = [
  'correcto',
  'fallido',
  'revertido',
  'fallo_de_restauracion',
];

export interface Deployment {
  readonly id: string;
  readonly candidateId: string;
  readonly entorno: EnvironmentType;
  readonly estado: DeploymentState;
  readonly start: string;
  readonly updatedAt: string;
  readonly end?: string;
  /** Despliegue que estaba activo antes y al que se vuelve si hay que revertir. */
  readonly previousDeploymentId?: string;
  /** Despliegue que se restauró tras revertir. */
  readonly restoredDeploymentId?: string;
  /** Quién aprobó; solo existe en producción. */
  readonly approverId?: string;
  readonly cause?: string;
}

const CANDIDATE_ID = /^cand-[0-9a-f]{12}$/;

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} es obligatorio`);
  return value;
};

function timestamp(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new Error(`${name} debe ser una fecha ISO 8601 en UTC`);
  return value;
}

export const isTerminal = (deployment: Pick<Deployment, 'estado'>): boolean =>
  TERMINAL.includes(deployment.estado);

export function createDeployment(input: unknown): Deployment {
  if (!isRecord(input)) throw new Error('El despliegue debe ser un objeto');
  assertKnownFields(input, [
    'id',
    'candidateId',
    'entorno',
    'start',
    'previousDeploymentId',
    'approverId',
  ]);
  const entorno = input['entorno'];
  if (typeof entorno !== 'string' || !(ENVIRONMENT_TYPES as readonly string[]).includes(entorno))
    throw new Error('entorno desconocido');
  const candidateId = text(input['candidateId'], 'candidateId');
  if (!CANDIDATE_ID.test(candidateId))
    throw new Error('candidateId debe ser el id de un candidato (cand-<12 hex>)');
  if (input['approverId'] !== undefined)
    throw new Error('El aprobador se registra al aprobar, no al crear el despliegue');
  const start = timestamp(input['start'], 'start');
  const previous = input['previousDeploymentId'];
  return Object.freeze({
    id: text(input['id'], 'id'),
    candidateId,
    entorno: entorno as EnvironmentType,
    estado: 'preparado' as const,
    start,
    updatedAt: start,
    ...(previous === undefined
      ? {}
      : { previousDeploymentId: text(previous, 'previousDeploymentId') }),
  });
}

export interface TransitionOptions {
  at: string;
  approverId?: string;
  smokePassed?: boolean;
  cause?: string;
  restoredDeploymentId?: string;
}

function allowed(deployment: Deployment): readonly DeploymentState[] {
  switch (deployment.estado) {
    case 'preparado':
      return deployment.entorno === 'production'
        ? ['esperando_aprobacion', 'fallido']
        : ['migrando', 'fallido'];
    case 'esperando_aprobacion':
      return ['migrando', 'fallido'];
    case 'migrando':
      // Si falla la migración no se activó nada (fallido); si falla el despliegue del backend ya pudo
      // cambiar algo y hay que restaurar la versión anterior (revirtiendo).
      return ['backend_listo', 'fallido', 'revirtiendo'];
    case 'backend_listo':
      return ['frontend_listo', 'revirtiendo'];
    case 'frontend_listo':
      return ['verificando', 'revirtiendo'];
    case 'verificando':
      return ['correcto', 'revirtiendo'];
    case 'revirtiendo':
      return ['revertido', 'fallo_de_restauracion'];
    default:
      return [];
  }
}

export function transition(
  deployment: Deployment,
  next: DeploymentState,
  options: TransitionOptions,
): Deployment {
  if (isTerminal(deployment))
    throw new Error(
      `El despliegue ${deployment.id} está en un estado terminal (${deployment.estado})`,
    );
  const at = timestamp(options.at, 'at');
  if (at < deployment.updatedAt)
    throw new Error(`La fecha ${at} es anterior al último cambio (${deployment.updatedAt})`);

  if (!allowed(deployment).includes(next)) {
    if (next === 'esperando_aprobacion' && deployment.entorno !== 'production')
      throw new Error('Solo un despliegue de producción espera aprobación');
    if (
      deployment.estado === 'preparado' &&
      deployment.entorno === 'production' &&
      next === 'migrando'
    )
      throw new Error('Producción exige pasar por la aprobación antes de migrar');
    throw new Error(`Transición no permitida: ${deployment.estado} → ${next}`);
  }

  const approving = deployment.estado === 'esperando_aprobacion' && next === 'migrando';
  if (approving && !options.approverId) throw new Error('Producción exige el aprobador');
  if (!approving && options.approverId !== undefined)
    throw new Error('El aprobador solo se registra al aprobar un despliegue de producción');

  if (next === 'correcto' && options.smokePassed !== true)
    throw new Error('No se marca «correcto» antes de que el smoke pase');
  if (next === 'revirtiendo' && !options.cause?.trim())
    throw new Error('Revertir exige indicar la causa');
  if (next === 'revertido') {
    const restored = options.restoredDeploymentId;
    if (!deployment.previousDeploymentId || restored !== deployment.previousDeploymentId)
      throw new Error(
        'Un despliegue revertido debe enlazar el despliegue restaurado, que es el anterior',
      );
  }

  const terminal = TERMINAL.includes(next);
  return Object.freeze({
    ...deployment,
    estado: next,
    updatedAt: at,
    ...(terminal ? { end: at } : {}),
    ...(approving ? { approverId: options.approverId! } : {}),
    ...(options.cause?.trim() ? { cause: options.cause.trim() } : {}),
    ...(next === 'revertido' ? { restoredDeploymentId: options.restoredDeploymentId! } : {}),
  });
}

/** Producción no admite dos despliegues a la vez: se serializan sin cancelar el que está activo. */
export function assertNoConcurrentProduction(
  deployments: readonly Deployment[],
  incoming: Pick<Deployment, 'id' | 'entorno'>,
): void {
  if (incoming.entorno !== 'production') return;
  const running = deployments.find(
    (item) => item.entorno === 'production' && item.id !== incoming.id && !isTerminal(item),
  );
  if (running)
    throw new Error(
      `Ya hay un despliegue de producción en curso (${running.id}): no se admiten despliegues simultáneos`,
    );
}
