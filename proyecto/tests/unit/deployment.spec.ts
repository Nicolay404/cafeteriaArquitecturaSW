import { describe, expect, it } from 'vitest';
import {
  assertNoConcurrentProduction,
  createDeployment,
  isTerminal,
  transition,
} from '../../packages/contracts/src/deployment.js';
import type { Deployment } from '../../packages/contracts/src/deployment.js';

// T058 — data-model.md: estados del despliegue y sus reglas. Nunca se marca «correcto» antes del
// smoke; el aprobador solo existe en producción; producción no admite dos despliegues a la vez;
// un rollback queda enlazado al despliegue que restauró.
const at = (minute: number) => `2026-11-18T10:${String(minute).padStart(2, '0')}:00.000Z`;
const candidateId = 'cand-691d523fb121';

const draft = (overrides: Record<string, unknown> = {}) =>
  createDeployment({
    id: 'dep-1',
    candidateId,
    entorno: 'staging',
    start: at(0),
    ...overrides,
  });

/** Avanza por una lista de estados con una marca de tiempo creciente. */
function walk(deployment: Deployment, states: Array<[string, Record<string, unknown>?]>) {
  return states.reduce(
    (current, [state, extra], index) =>
      transition(current, state as never, { at: at(index + 1), ...extra }),
    deployment,
  );
}

describe('creación', () => {
  it('nace en «preparado», inmutable y sin resultado', () => {
    const deployment = draft();
    expect(deployment.estado).toBe('preparado');
    expect(deployment.end).toBeUndefined();
    expect(Object.isFrozen(deployment)).toBe(true);
  });

  it.each([
    ['id vacío', { id: '' }],
    ['candidato con otra forma', { candidateId: 'v1.2.3' }],
    ['entorno desconocido', { entorno: 'qa' }],
    ['fecha que no es ISO', { start: 'ayer' }],
    ['aprobador en un entorno que no es producción', { approverId: 'nicolay404' }],
    ['campo desconocido', { token: 'x' }],
  ])('rechaza %s', (_nombre, overrides) => {
    expect(() => draft(overrides)).toThrow();
  });

  it('un despliegue de producción puede nombrar al que reemplaza', () => {
    const deployment = draft({ entorno: 'production', previousDeploymentId: 'dep-0' });
    expect(deployment.previousDeploymentId).toBe('dep-0');
  });
});

describe('camino feliz', () => {
  it('staging: preparado → migrando → backend → frontend → verificando → correcto', () => {
    const done = walk(draft(), [
      ['migrando'],
      ['backend_listo'],
      ['frontend_listo'],
      ['verificando'],
      ['correcto', { smokePassed: true }],
    ]);
    expect(done.estado).toBe('correcto');
    expect(done.end).toBe(at(5));
    expect(isTerminal(done)).toBe(true);
  });

  it('producción exige pasar por la aprobación y llevar al aprobador', () => {
    const production = draft({ entorno: 'production' });
    expect(() => transition(production, 'migrando', { at: at(1) })).toThrow(/aprobaci/i);
    const waiting = transition(production, 'esperando_aprobacion', { at: at(1) });
    expect(() => transition(waiting, 'migrando', { at: at(2) })).toThrow(/aprobador/i);
    const approved = transition(waiting, 'migrando', { at: at(2), approverId: 'rafapalacios5' });
    expect(approved.approverId).toBe('rafapalacios5');
    expect(approved.estado).toBe('migrando');
  });

  it('fuera de producción no hay aprobación ni aprobador', () => {
    expect(() => transition(draft(), 'esperando_aprobacion', { at: at(1) })).toThrow(/producci/i);
    expect(() => transition(draft(), 'migrando', { at: at(1), approverId: 'nicolay404' })).toThrow(
      /aprobador/i,
    );
  });
});

describe('nunca correcto antes del smoke', () => {
  const verifying = () =>
    walk(draft(), [['migrando'], ['backend_listo'], ['frontend_listo'], ['verificando']]);

  it('«correcto» exige que el smoke haya pasado', () => {
    expect(() => transition(verifying(), 'correcto', { at: at(9) })).toThrow(/smoke/i);
    expect(() => transition(verifying(), 'correcto', { at: at(9), smokePassed: false })).toThrow(
      /smoke/i,
    );
  });

  it.each(['preparado', 'migrando', 'backend_listo', 'frontend_listo'])(
    'no se puede saltar a «correcto» desde «%s»',
    (state) => {
      const path: Record<string, Array<[string]>> = {
        preparado: [],
        migrando: [['migrando']],
        backend_listo: [['migrando'], ['backend_listo']],
        frontend_listo: [['migrando'], ['backend_listo'], ['frontend_listo']],
      };
      const current = walk(draft(), path[state]!);
      expect(() => transition(current, 'correcto', { at: at(9), smokePassed: true })).toThrow(
        /transici/i,
      );
    },
  );

  it('los estados terminales no admiten más cambios', () => {
    const done = transition(verifying(), 'correcto', { at: at(9), smokePassed: true });
    expect(() => transition(done, 'revirtiendo', { at: at(10) })).toThrow(/terminal/i);
  });
});

describe('fallos y reversión', () => {
  it('un fallo antes de activar conserva la versión anterior (fallido, sin tocar nada)', () => {
    const failed = transition(walk(draft(), [['migrando']]), 'fallido', {
      at: at(5),
      cause: 'La migración 002 falló',
    });
    expect(failed.estado).toBe('fallido');
    expect(failed.cause).toBe('La migración 002 falló');
    expect(isTerminal(failed)).toBe(true);
  });

  it('si falla el despliegue del backend estando en migrando se puede revertir', () => {
    const migrating = walk(draft({ previousDeploymentId: 'dep-0' }), [['migrando']]);
    const reverting = transition(migrating, 'revirtiendo', {
      at: at(5),
      cause: 'El backend no arrancó',
    });
    expect(reverting.estado).toBe('revirtiendo');
    expect(
      transition(reverting, 'revertido', { at: at(6), restoredDeploymentId: 'dep-0' }).estado,
    ).toBe('revertido');
  });

  it('un smoke fallido pasa a revertir y termina revertido, enlazado al despliegue restaurado', () => {
    const base = draft({ previousDeploymentId: 'dep-0' });
    const reverting = walk(base, [
      ['migrando'],
      ['backend_listo'],
      ['frontend_listo'],
      ['verificando'],
      ['revirtiendo', { cause: 'El smoke falló' }],
    ]);
    expect(() => transition(reverting, 'revertido', { at: at(9) })).toThrow(/restaurado/i);
    expect(() =>
      transition(reverting, 'revertido', { at: at(9), restoredDeploymentId: 'dep-otro' }),
    ).toThrow(/restaurado/i);
    const reverted = transition(reverting, 'revertido', {
      at: at(9),
      restoredDeploymentId: 'dep-0',
    });
    expect(reverted.restoredDeploymentId).toBe('dep-0');
    expect(isTerminal(reverted)).toBe(true);
  });

  it('un rollback sin despliegue anterior no puede declararse revertido', () => {
    const reverting = walk(draft(), [
      ['migrando'],
      ['backend_listo'],
      ['revirtiendo', { cause: 'fallo del frontend' }],
    ]);
    expect(() =>
      transition(reverting, 'revertido', { at: at(9), restoredDeploymentId: 'dep-0' }),
    ).toThrow(/restaurado/i);
    expect(transition(reverting, 'fallo_de_restauracion', { at: at(9) }).estado).toBe(
      'fallo_de_restauracion',
    );
  });

  it('revirtiendo exige la causa y el fallo de restauración es terminal', () => {
    const verifying = walk(draft({ previousDeploymentId: 'dep-0' }), [
      ['migrando'],
      ['backend_listo'],
      ['frontend_listo'],
      ['verificando'],
    ]);
    expect(() => transition(verifying, 'revirtiendo', { at: at(9) })).toThrow(/causa/i);
    const reverting = transition(verifying, 'revirtiendo', { at: at(9), cause: 'smoke' });
    const lost = transition(reverting, 'fallo_de_restauracion', { at: at(10) });
    expect(isTerminal(lost)).toBe(true);
  });

  it('el fin no puede ser anterior al inicio ni al último cambio', () => {
    expect(() => transition(draft({ start: at(30) }), 'migrando', { at: at(5) })).toThrow(
      /anterior/i,
    );
    const migrating = walk(draft(), [['migrando']]);
    expect(() => transition(migrating, 'backend_listo', { at: at(0) })).toThrow(/anterior/i);
  });

  it('se rechazan las transiciones que no existen', () => {
    expect(() => transition(draft(), 'verificando', { at: at(1) })).toThrow(/transici/i);
    expect(() => transition(draft(), 'revertido', { at: at(1) })).toThrow(/transici/i);
  });
});

describe('producción no admite dos despliegues a la vez', () => {
  const active = (id: string, entorno: string, estado = 'migrando') =>
    ({ ...draft({ id, entorno }), estado }) as unknown as Deployment;

  it('rechaza uno nuevo mientras otro de producción no ha terminado', () => {
    const incoming = draft({ id: 'dep-2', entorno: 'production' });
    expect(() => assertNoConcurrentProduction([active('dep-1', 'production')], incoming)).toThrow(
      /dep-1/,
    );
    for (const estado of ['esperando_aprobacion', 'backend_listo', 'verificando', 'revirtiendo'])
      expect(() =>
        assertNoConcurrentProduction([active('dep-1', 'production', estado)], incoming),
      ).toThrow(/simult/i);
  });

  it('permite uno nuevo cuando los anteriores terminaron o son de otro entorno', () => {
    const incoming = draft({ id: 'dep-2', entorno: 'production' });
    expect(() =>
      assertNoConcurrentProduction(
        [
          active('dep-1', 'production', 'correcto'),
          active('dep-3', 'production', 'revertido'),
          active('dep-4', 'staging'),
        ],
        incoming,
      ),
    ).not.toThrow();
  });

  it('staging y preview no se serializan entre sí con producción', () => {
    expect(() =>
      assertNoConcurrentProduction([active('dep-1', 'production')], draft({ id: 'dep-9' })),
    ).not.toThrow();
  });
});
