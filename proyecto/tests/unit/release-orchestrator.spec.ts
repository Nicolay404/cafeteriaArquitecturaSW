import { describe, expect, it } from 'vitest';
import { buildCandidate, candidateId } from '../../packages/contracts/src/candidate.js';
import { createDeployment, transition } from '../../packages/contracts/src/deployment.js';
import type { Deployment } from '../../packages/contracts/src/deployment.js';
import { release } from '../../scripts/deploy/release.js';
import type { Adapters } from '../../scripts/deploy/release.js';

// T057 — FR-014/015/016/017: la liberación sigue un orden fijo, la aprobación pertenece a UN
// candidato, producción se serializa, y cualquier fallo conserva o restaura la versión anterior.
// Los adaptadores son simulados: esto prueba la lógica del orquestador, no una plataforma real.
const candidate = buildCandidate({
  sha: 'a'.repeat(40),
  digestApi: `sha256:${'1'.repeat(64)}`,
  digestWorker: `sha256:${'2'.repeat(64)}`,
  digestWeb: `sha256:${'4'.repeat(64)}`,
  hashWeb: `sha256:${'3'.repeat(64)}`,
  migrationChecksums: { '001': 'b'.repeat(64) },
  configRevision: 'rev-1',
  reportRefs: [],
});
const id = candidateId(candidate);
const clock = () => {
  let minute = 0;
  return () => `2026-11-18T11:${String(minute++).padStart(2, '0')}:00.000Z`;
};

/** Un despliegue anterior ya terminado correctamente, al que se vuelve si hay que revertir. */
const previousDeployment = (): Deployment => {
  let current = createDeployment({
    id: 'dep-0',
    candidateId: 'cand-000000000000',
    entorno: 'production',
    start: '2026-11-17T09:00:00.000Z',
  });
  const steps = [
    ['esperando_aprobacion', {}],
    ['migrando', { approverId: 'mpguallo' }],
    ['backend_listo', {}],
    ['frontend_listo', {}],
    ['verificando', {}],
    ['correcto', { smokePassed: true }],
  ] as const;
  steps.forEach(([state, extra], index) => {
    current = transition(current, state, {
      at: `2026-11-17T09:0${index + 1}:00.000Z`,
      ...extra,
    });
  });
  return current;
};

type Overrides = Partial<{
  [K in keyof Adapters]: Adapters[K];
}>;

function adapters(overrides: Overrides = {}) {
  const calls: string[] = [];
  const alerts: string[] = [];
  const base: Adapters = {
    approval: async (forId) => {
      calls.push('aprobación');
      return { candidateId: forId, approverId: 'rafapalacios5' };
    },
    migrate: async () => void calls.push('migrar'),
    deployBackend: async () => void calls.push('backend'),
    deployFrontend: async () => void calls.push('web'),
    smoke: async () => {
      calls.push('smoke');
      return true;
    },
    restore: async () => {
      calls.push('restaurar');
      return true;
    },
    alert: async (message) => void alerts.push(message),
  };
  return { calls, alerts, adapters: { ...base, ...overrides } as Adapters };
}

const run = (
  environment: 'preview' | 'staging' | 'production',
  setup: ReturnType<typeof adapters>,
  extra: Partial<Parameters<typeof release>[0]> = {},
) =>
  release({
    candidate,
    environment,
    deploymentId: 'dep-1',
    adapters: setup.adapters,
    now: clock(),
    active: [],
    provenIn: ['staging'],
    ...extra,
  });

describe('camino correcto', () => {
  it('staging: migra, despliega el backend, luego la web, y solo entonces verifica', async () => {
    const setup = adapters();
    const result = await run('staging', setup);
    expect(setup.calls).toEqual(['migrar', 'backend', 'web', 'smoke']);
    expect(result.deployment.estado).toBe('correcto');
    expect(result.deployment.candidateId).toBe(id);
    expect(result.history).toEqual([
      'preparado',
      'migrando',
      'backend_listo',
      'frontend_listo',
      'verificando',
      'correcto',
    ]);
    expect(setup.alerts).toEqual([]);
  });

  it('producción: pide la aprobación de ESTE candidato antes de tocar nada', async () => {
    const setup = adapters();
    const result = await run('production', setup, { previous: previousDeployment() });
    expect(setup.calls).toEqual(['aprobación', 'migrar', 'backend', 'web', 'smoke']);
    expect(result.deployment.estado).toBe('correcto');
    expect(result.deployment.approverId).toBe('rafapalacios5');
    expect(result.history).toContain('esperando_aprobacion');
    expect(result.deployment.previousDeploymentId).toBe('dep-0');
  });
});

describe('aprobación y requisitos de producción', () => {
  it('sin aprobación no se despliega nada y la versión anterior queda intacta', async () => {
    const setup = adapters({ approval: async () => null });
    const result = await run('production', setup, { previous: previousDeployment() });
    expect(setup.calls).toEqual([]);
    expect(result.deployment.estado).toBe('fallido');
    expect(result.deployment.cause).toMatch(/aprobaci/i);
  });

  it('la aprobación de otro candidato no vale', async () => {
    const setup = adapters({
      approval: async () => ({ candidateId: 'cand-ffffffffffff', approverId: 'rafapalacios5' }),
    });
    const result = await run('production', setup);
    expect(setup.calls).toEqual([]);
    expect(result.deployment.estado).toBe('fallido');
    expect(result.deployment.cause).toMatch(/otro candidato/i);
  });

  it('un candidato que no pasó por staging no llega a producción', async () => {
    const setup = adapters();
    const result = await run('production', setup, { provenIn: [] });
    expect(setup.calls).toEqual([]);
    expect(result.deployment.estado).toBe('fallido');
    expect(result.deployment.cause).toMatch(/staging/i);
  });

  it('un preview o un staging no necesitan aprobación ni pasar por staging', async () => {
    for (const environment of ['preview', 'staging'] as const) {
      const setup = adapters();
      const result = await run(environment, setup, { provenIn: [] });
      expect(result.deployment.estado).toBe('correcto');
      expect(setup.calls).not.toContain('aprobación');
    }
  });

  it('dos liberaciones de producción no corren a la vez: la segunda se rechaza sin tocar nada', async () => {
    const running = transition(
      createDeployment({
        id: 'dep-0',
        candidateId: 'cand-111111111111',
        entorno: 'production',
        start: '2026-11-18T10:00:00.000Z',
      }),
      'esperando_aprobacion',
      { at: '2026-11-18T10:01:00.000Z' },
    );
    const setup = adapters();
    await expect(run('production', setup, { active: [running] })).rejects.toThrow(/simult/i);
    expect(setup.calls).toEqual([]);
  });
});

describe('fallos', () => {
  it('si falla la migración, no se despliega nada y se conserva la versión anterior', async () => {
    const setup = adapters({
      migrate: async () => {
        throw new Error('la migración 002 falló');
      },
    });
    const result = await run('staging', setup, { previous: previousDeployment() });
    expect(setup.calls).toEqual([]);
    expect(result.deployment.estado).toBe('fallido');
    expect(result.deployment.cause).toMatch(/migraci.*002/i);
    expect(result.history).not.toContain('backend_listo');
    expect(setup.alerts).toHaveLength(1);
  });

  it.each([
    ['backend', 'deployBackend', ['migrar', 'restaurar']],
    ['web', 'deployFrontend', ['migrar', 'backend', 'restaurar']],
  ] as const)(
    'si falla el despliegue de %s, se restaura la versión anterior',
    async (_name, key, expected) => {
      const setup = adapters({
        [key]: async () => {
          throw new Error('no arrancó');
        },
      });
      const result = await run('production', setup, { previous: previousDeployment() });
      expect(setup.calls.filter((call) => call !== 'aprobación')).toEqual([...expected]);
      expect(result.deployment.estado).toBe('revertido');
      expect(result.deployment.restoredDeploymentId).toBe('dep-0');
      expect(setup.alerts).toHaveLength(1);
    },
  );

  it('un smoke fallido revierte, restaura la anterior y alerta; nunca llega a «correcto»', async () => {
    const setup = adapters({ smoke: async () => false });
    const result = await run('production', setup, { previous: previousDeployment() });
    expect(setup.calls).toEqual(['aprobación', 'migrar', 'backend', 'web', 'restaurar']);
    expect(result.deployment.estado).toBe('revertido');
    expect(result.deployment.restoredDeploymentId).toBe('dep-0');
    expect(result.history).not.toContain('correcto');
    expect(result.history.slice(-2)).toEqual(['revirtiendo', 'revertido']);
    expect(setup.alerts.join(' ')).toMatch(/smoke/i);
  });

  it('un smoke que lanza una excepción cuenta como fallo', async () => {
    const setup = adapters({
      smoke: async () => {
        throw new Error('sin respuesta');
      },
    });
    const result = await run('staging', setup, { previous: previousDeployment() });
    expect(result.deployment.estado).toBe('revertido');
    expect(result.deployment.cause).toMatch(/sin respuesta/);
  });

  it('si la restauración falla, queda «fallo_de_restauracion» y se alerta', async () => {
    const setup = adapters({ smoke: async () => false, restore: async () => false });
    const result = await run('staging', setup, { previous: previousDeployment() });
    expect(result.deployment.estado).toBe('fallo_de_restauracion');
    expect(setup.alerts.join(' ')).toMatch(/restaur/i);
  });

  it('si la restauración lanza una excepción, tampoco se da por revertido', async () => {
    const setup = adapters({
      smoke: async () => false,
      restore: async () => {
        throw new Error('imagen anterior no disponible');
      },
    });
    const result = await run('staging', setup, { previous: previousDeployment() });
    expect(result.deployment.estado).toBe('fallo_de_restauracion');
  });

  it('sin versión anterior no hay a qué volver: queda «fallo_de_restauracion»', async () => {
    const setup = adapters({ smoke: async () => false });
    const result = await run('staging', setup);
    expect(setup.calls).not.toContain('restaurar');
    expect(result.deployment.estado).toBe('fallo_de_restauracion');
    expect(setup.alerts).toHaveLength(1);
  });

  it('una excepción que no es un Error se informa sin romper el orquestador', async () => {
    const setup = adapters({
      deployBackend: async () => {
        throw 'texto suelto';
      },
    });
    const result = await run('staging', setup, { previous: previousDeployment() });
    expect(result.deployment.estado).toBe('revertido');
    expect(result.deployment.cause).toBeTruthy();
  });
});

describe('trazabilidad', () => {
  it('registra cada paso en orden para poder auditar el despliegue', async () => {
    const result = await run('staging', adapters());
    expect(result.steps).toEqual([
      'migrar',
      'desplegar backend',
      'desplegar web',
      'smoke',
      'correcto',
    ]);
  });
});
