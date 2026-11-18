import { candidateId } from '../../packages/contracts/src/candidate.js';
import type { Candidate } from '../../packages/contracts/src/candidate.js';
import {
  assertNoConcurrentProduction,
  createDeployment,
  transition,
} from '../../packages/contracts/src/deployment.js';
import type {
  Deployment,
  DeploymentState,
  TransitionOptions,
} from '../../packages/contracts/src/deployment.js';
import type { EnvironmentType } from '../../packages/contracts/src/environment.js';

// Orquestador de liberación (FR-014 a FR-017). Sigue un orden fijo y comprobable: migrar → backend
// (API y worker) → web → smoke. En producción, además, exige que el candidato haya pasado por
// staging y que exista la aprobación de ESE candidato. Un fallo antes de activar conserva la
// versión anterior; uno después la restaura; si no puede restaurar, lo dice y alerta. Nunca marca
// «correcto» antes de que el smoke pase. No sabe nada de plataformas: todo efecto ocurre en los
// adaptadores, lo que permite ensayarlo y probarlo sin infraestructura.
export interface Approval {
  candidateId: string;
  approverId: string;
}

export interface Adapters {
  /** Aprobación vigente del candidato (solo se consulta en producción). */
  approval: (candidateId: string) => Promise<Approval | null>;
  migrate: (candidate: Candidate) => Promise<void>;
  /** API y worker, por digest. */
  deployBackend: (candidate: Candidate) => Promise<void>;
  deployFrontend: (candidate: Candidate) => Promise<void>;
  smoke: (candidate: Candidate) => Promise<boolean>;
  /** Vuelve a la versión anterior y comprueba que responde. `true` solo si quedó sana. */
  restore: (previous: Deployment) => Promise<boolean>;
  alert: (message: string) => Promise<void>;
}

export interface ReleaseInput {
  candidate: Candidate;
  environment: EnvironmentType;
  deploymentId: string;
  adapters: Adapters;
  now: () => string;
  /** Despliegues en curso o recientes, para serializar producción. */
  active: readonly Deployment[];
  /** Despliegue correcto anterior al que se vuelve si hay que revertir. */
  previous?: Deployment;
  /** Entornos en los que este candidato ya terminó correctamente. */
  provenIn: readonly string[];
}

export interface ReleaseResult {
  deployment: Deployment;
  /** Estados por los que pasó, en orden. */
  history: DeploymentState[];
  /** Pasos ejecutados, para auditarlos. */
  steps: string[];
}

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function release(input: ReleaseInput): Promise<ReleaseResult> {
  const { candidate, adapters, environment } = input;
  const id = candidateId(candidate);
  if (input.previous && input.previous.estado !== 'correcto')
    throw new Error('La versión anterior debe ser un despliegue correcto');

  let deployment = createDeployment({
    id: input.deploymentId,
    candidateId: id,
    entorno: environment,
    start: input.now(),
    ...(input.previous ? { previousDeploymentId: input.previous.id } : {}),
  });
  // Antes de tocar nada: producción no admite dos despliegues a la vez.
  assertNoConcurrentProduction(input.active, deployment);

  const history: DeploymentState[] = ['preparado'];
  const steps: string[] = [];
  const move = (state: DeploymentState, options: Omit<TransitionOptions, 'at'> = {}) => {
    deployment = transition(deployment, state, { at: input.now(), ...options });
    history.push(state);
  };
  const alert = async (message: string) => {
    // Avisar es best-effort: un fallo del canal no puede ocultar el resultado del despliegue.
    try {
      await adapters.alert(message);
    } catch {
      steps.push('alerta no entregada');
    }
  };
  const result = (): ReleaseResult => ({ deployment, history, steps });
  const abort = async (cause: string): Promise<ReleaseResult> => {
    move('fallido', { cause });
    await alert(`Despliegue ${deployment.id} no iniciado o abortado: ${cause}`);
    return result();
  };

  if (environment === 'production') {
    if (!input.provenIn.includes('staging'))
      return abort('El candidato no pasó por staging: producción solo recibe lo ya probado allí');
    move('esperando_aprobacion');
    let approval: Approval | null = null;
    try {
      approval = await adapters.approval(id);
    } catch (error) {
      return abort(`No se pudo consultar la aprobación: ${describe(error)}`);
    }
    if (!approval) return abort('Falta la aprobación del candidato');
    if (approval.candidateId !== id)
      return abort(
        `La aprobación es de otro candidato (${approval.candidateId}) y no autoriza este`,
      );
    move('migrando', { approverId: approval.approverId });
  } else move('migrando');

  // 1) Migrar. Si falla no se activó nada: la versión anterior sigue atendiendo.
  try {
    await adapters.migrate(candidate);
    steps.push('migrar');
  } catch (error) {
    return abort(`Falló la migración: ${describe(error)}`);
  }

  // Desde aquí algo pudo cambiar: un fallo se revierte a la versión anterior.
  const revert = async (cause: string): Promise<ReleaseResult> => {
    move('revirtiendo', { cause });
    steps.push('restaurar');
    let restored = false;
    if (input.previous) {
      try {
        restored = await adapters.restore(input.previous);
      } catch (error) {
        cause = `${cause}; la restauración falló: ${describe(error)}`;
      }
    }
    if (restored && input.previous) {
      move('revertido', { restoredDeploymentId: input.previous.id });
      await alert(`Despliegue ${deployment.id} revertido a ${input.previous.id}: ${cause}`);
    } else {
      move('fallo_de_restauracion');
      await alert(
        `FALLO DE RESTAURACIÓN en ${deployment.id}: ${cause}. ${
          input.previous
            ? 'La versión anterior no quedó sana.'
            : 'No hay versión anterior a la que volver.'
        }`,
      );
    }
    return result();
  };

  try {
    await adapters.deployBackend(candidate);
    steps.push('desplegar backend');
  } catch (error) {
    return revert(`Falló el despliegue del backend: ${describe(error)}`);
  }
  move('backend_listo');

  try {
    await adapters.deployFrontend(candidate);
    steps.push('desplegar web');
  } catch (error) {
    return revert(`Falló el despliegue de la web: ${describe(error)}`);
  }
  move('frontend_listo');
  move('verificando');

  let healthy = false;
  let cause = 'El smoke falló';
  try {
    healthy = await adapters.smoke(candidate);
    steps.push('smoke');
  } catch (error) {
    cause = `El smoke falló: ${describe(error)}`;
  }
  if (!healthy) return revert(cause);

  move('correcto', { smokePassed: true });
  steps.push('correcto');
  return result();
}
