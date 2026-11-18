import { describe, expect, it } from 'vitest';
import {
  THRESHOLDS,
  contarHallazgosGitleaks,
  contarHallazgosTrivy,
  evaluarCalidad,
  evaluarEjecuciones,
  evaluarSeguridad,
  fromSonarMeasures,
  parseResultadoCalidad,
} from '../../scripts/ci/quality-gate.js';
import type { ResultadoCalidad } from '../../scripts/ci/quality-gate.js';

// T024/T027 — FR-006/007/008 y Constitución VI. Todo fixture es sintético y público: ningún
// secreto ni vulnerabilidad real. Los umbrales no se bajan sin enmendar la constitución.
const sha = 'a'.repeat(40);

const bueno = (cambios: Partial<ResultadoCalidad> = {}): ResultadoCalidad => ({
  analysisId: 'AX-1',
  sha,
  cobertura: 80,
  bugs: 0,
  vulnerabilidades: 0,
  hotspotsRevisados: 100,
  duplicacion: 2.99,
  ratings: { mantenibilidad: 'A', fiabilidad: 'A', seguridad: 'A' },
  coberturaModulos: {},
  ...cambios,
});

describe('umbrales de la constitución (Principio VI, FR-007)', () => {
  it('coinciden con los valores vigentes; bajarlos exige una enmienda', () => {
    expect(THRESHOLDS).toEqual({
      cobertura: 80,
      coberturaCritica: 95,
      bugs: 0,
      vulnerabilidades: 0,
      hotspotsRevisados: 100,
      duplicacionMaxima: 3,
      rating: 'A',
      modulosCriticos: ['promociones', 'pedidos', 'pagos'],
    });
  });
});

describe('evaluarCalidad', () => {
  const evaluar = (resultado: ResultadoCalidad | null | undefined, extra = {}) =>
    evaluarCalidad(resultado, { sha, ...extra });

  it('aprueba cuando se cumplen todos los mínimos, incluidos los límites exactos', () => {
    expect(evaluar(bueno())).toEqual({ aprobado: true, razones: [], noAplica: [] });
  });

  it('rechaza una cobertura nueva por debajo del 80 %', () => {
    const resultado = evaluar(bueno({ cobertura: 79.9 }));
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(/cobertura.*79[.,]9.*80/i);
  });

  it('exige 95 % solo en los módulos críticos que cambian', () => {
    const cobertura = { promociones: 94.9, pedidos: 95, pagos: 100 };
    const cambia = evaluar(bueno({ coberturaModulos: cobertura }), {
      modulosCambiados: ['promociones', 'pedidos'],
    });
    expect(cambia.aprobado).toBe(false);
    expect(cambia.razones.join(' ')).toMatch(/promociones.*94[.,]9.*95/i);
    expect(cambia.razones.join(' ')).not.toMatch(/pedidos/i);
    // Si el módulo crítico no cambia, rige solo el 80 % general.
    expect(
      evaluar(bueno({ coberturaModulos: cobertura }), { modulosCambiados: ['pedidos'] }).aprobado,
    ).toBe(true);
    expect(
      evaluar(bueno({ coberturaModulos: cobertura }), { modulosCambiados: ['catalogo'] }).aprobado,
    ).toBe(true);
  });

  it('un módulo crítico modificado sin dato de cobertura no se da por bueno', () => {
    const resultado = evaluar(bueno(), { modulosCambiados: ['pagos'] });
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(/pagos.*sin dato/i);
  });

  it.each([
    [{ bugs: 1 }, /bugs/i],
    [{ vulnerabilidades: 1 }, /vulnerabilidades/i],
    [{ hotspotsRevisados: 99 }, /hotspots/i],
    [{ duplicacion: 3 }, /duplicaci/i],
    [{ ratings: { mantenibilidad: 'B', fiabilidad: 'A', seguridad: 'A' } }, /mantenibilidad/i],
    [{ ratings: { mantenibilidad: 'A', fiabilidad: 'C', seguridad: 'A' } }, /fiabilidad/i],
    [{ ratings: { mantenibilidad: 'A', fiabilidad: 'A', seguridad: 'E' } }, /seguridad/i],
  ] as const)('rechaza %j', (cambio, patron) => {
    const resultado = evaluar(bueno(cambio));
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(patron);
  });

  it('informa todas las causas a la vez para que el PR muestre el motivo completo (FR-008)', () => {
    const resultado = evaluar(bueno({ cobertura: 10, bugs: 2, hotspotsRevisados: 50 }));
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones).toHaveLength(3);
  });

  it('la ausencia de resultado de Sonar nunca significa aprobado', () => {
    for (const ausente of [null, undefined]) {
      const resultado = evaluar(ausente);
      expect(resultado.aprobado).toBe(false);
      expect(resultado.razones.join(' ')).toMatch(/ausen/i);
    }
  });

  it('un análisis de otro commit no aprueba este', () => {
    const resultado = evaluar(bueno({ sha: 'b'.repeat(40) }));
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(/otro commit/i);
  });

  it('en un PR solo de documentación la cobertura no aplica, sin inventar un 100 %', () => {
    const resultado = evaluar(bueno({ cobertura: null }), { soloDocumentacion: true });
    expect(resultado).toEqual({
      aprobado: true,
      razones: [],
      noAplica: ['cobertura'],
    });
    // El resto de controles siguen vigentes.
    expect(evaluar(bueno({ cobertura: null, bugs: 1 }), { soloDocumentacion: true }).aprobado).toBe(
      false,
    );
    // Fuera de documentación, una cobertura ausente bloquea.
    const codigo = evaluar(bueno({ cobertura: null }));
    expect(codigo.aprobado).toBe(false);
    expect(codigo.razones.join(' ')).toMatch(/cobertura.*sin dato/i);
  });
});

describe('parseResultadoCalidad', () => {
  const valido = () => ({ ...bueno() });

  it('acepta un resultado completo', () => {
    expect(parseResultadoCalidad(valido()).sha).toBe(sha);
  });

  it.each([
    ['cobertura > 100', { cobertura: 100.1 }],
    ['cobertura negativa', { cobertura: -1 }],
    ['bugs negativos', { bugs: -1 }],
    ['bugs no enteros', { bugs: 1.5 }],
    ['vulnerabilidades no numéricas', { vulnerabilidades: 'cero' }],
    ['hotspots > 100', { hotspotsRevisados: 101 }],
    ['duplicación NaN', { duplicacion: Number.NaN }],
    ['SHA corto', { sha: 'abc123' }],
    ['rating inválido', { ratings: { mantenibilidad: 'Z', fiabilidad: 'A', seguridad: 'A' } }],
    ['sin analysisId', { analysisId: '' }],
  ])('rechaza %s', (_nombre, cambio) => {
    expect(() => parseResultadoCalidad({ ...valido(), ...cambio })).toThrow();
  });

  it('rechaza lo que no es un objeto', () => {
    for (const entrada of [null, undefined, 'texto', 42, []]) {
      expect(() => parseResultadoCalidad(entrada)).toThrow();
    }
  });
});

describe('fromSonarMeasures', () => {
  const medida = (metric: string, value: string, forma: 'period' | 'periods' = 'period') =>
    forma === 'period' ? { metric, period: { value } } : { metric, periods: [{ index: 1, value }] };
  const medidas = (forma: 'period' | 'periods') => [
    medida('new_coverage', '81.5', forma),
    medida('new_bugs', '0', forma),
    medida('new_vulnerabilities', '0', forma),
    medida('new_security_hotspots_reviewed', '100.0', forma),
    medida('new_duplicated_lines_density', '1.2', forma),
    medida('new_maintainability_rating', '1.0', forma),
    medida('new_reliability_rating', '1.0', forma),
    medida('new_security_rating', '2.0', forma),
  ];

  it.each(['period', 'periods'] as const)('traduce las métricas de código nuevo (%s)', (forma) => {
    expect(fromSonarMeasures({ analysisId: 'AX-9', sha, measures: medidas(forma) })).toMatchObject({
      analysisId: 'AX-9',
      sha,
      cobertura: 81.5,
      bugs: 0,
      vulnerabilidades: 0,
      hotspotsRevisados: 100,
      duplicacion: 1.2,
      ratings: { mantenibilidad: 'A', fiabilidad: 'A', seguridad: 'B' },
    });
  });

  it('una métrica ausente falla en lugar de rellenarse con un valor favorable', () => {
    const sinBugs = medidas('period').filter((item) => item.metric !== 'new_bugs');
    expect(() => fromSonarMeasures({ analysisId: 'AX-9', sha, measures: sinBugs })).toThrow(
      /new_bugs/,
    );
  });

  it('sin cobertura nueva (documentación) la deja como no disponible, no como 0 ni 100', () => {
    const sinCobertura = medidas('period').filter((item) => item.metric !== 'new_coverage');
    expect(
      fromSonarMeasures({ analysisId: 'AX-9', sha, measures: sinCobertura }).cobertura,
    ).toBeNull();
  });
});

describe('seguridad (secretos y vulnerabilidades altas o críticas bloquean, FR-006)', () => {
  // Informes sintéticos con la forma de Gitleaks y Trivy; ningún valor es un secreto real.
  const gitleaks = [
    { RuleID: 'aws-access-token', File: 'fixtures/ejemplo.env', StartLine: 3, Secret: 'REDACTED' },
  ];
  const trivy = (...severidades: string[]) => ({
    Results: [
      {
        Target: 'imagen:api',
        Vulnerabilities: severidades.map((Severity, indice) => ({
          VulnerabilityID: `CVE-0000-000${indice}`,
          Severity,
        })),
      },
    ],
  });

  it('cuenta los hallazgos de cada herramienta', () => {
    expect(contarHallazgosGitleaks(gitleaks)).toBe(1);
    expect(contarHallazgosGitleaks([])).toBe(0);
    expect(contarHallazgosTrivy(trivy('HIGH', 'CRITICAL', 'MEDIUM', 'LOW'))).toBe(2);
    expect(contarHallazgosTrivy({ Results: [{ Target: 'x' }] })).toBe(0);
  });

  it('un secreto detectado bloquea', () => {
    const resultado = evaluarSeguridad({
      secretos: contarHallazgosGitleaks(gitleaks),
      altasCriticas: 0,
    });
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(/secreto/i);
  });

  it('una vulnerabilidad alta o crítica bloquea, una media no', () => {
    expect(
      evaluarSeguridad({ secretos: 0, altasCriticas: contarHallazgosTrivy(trivy('CRITICAL')) })
        .aprobado,
    ).toBe(false);
    expect(
      evaluarSeguridad({ secretos: 0, altasCriticas: contarHallazgosTrivy(trivy('MEDIUM')) })
        .aprobado,
    ).toBe(true);
  });

  it('la ausencia de informe de seguridad no significa aprobado', () => {
    const resultado = evaluarSeguridad(null);
    expect(resultado.aprobado).toBe(false);
    expect(resultado.razones.join(' ')).toMatch(/ausen/i);
  });

  it('un informe con forma inesperada falla en lugar de contar cero', () => {
    expect(() => contarHallazgosGitleaks({ no: 'es una lista' })).toThrow();
    expect(() => contarHallazgosTrivy('texto')).toThrow();
  });
});

describe('evaluarEjecuciones: un fallo intermitente no se borra con un reintento', () => {
  it('todo correcto al primer intento', () => {
    expect(evaluarEjecuciones([{ intento: 1, resultado: 'correcto' }])).toMatchObject({
      estado: 'correcto',
      aprobado: true,
      fallosOriginales: [],
    });
  });

  it('un fallo seguido de un éxito es intermitente: bloquea y conserva la causa original', () => {
    const resultado = evaluarEjecuciones([
      { intento: 1, resultado: 'fallido', causa: 'integración: Redis agotó el tiempo' },
      { intento: 2, resultado: 'correcto' },
    ]);
    expect(resultado.estado).toBe('intermitente');
    expect(resultado.aprobado).toBe(false);
    expect(resultado.fallosOriginales).toEqual([
      { intento: 1, resultado: 'fallido', causa: 'integración: Redis agotó el tiempo' },
    ]);
    expect(resultado.razones.join(' ')).toMatch(/intermitente.*intento 1.*Redis/i);
  });

  it('fallar en todos los intentos es un fallo, no intermitencia', () => {
    const resultado = evaluarEjecuciones([
      { intento: 1, resultado: 'fallido', causa: 'a' },
      { intento: 2, resultado: 'fallido', causa: 'b' },
    ]);
    expect(resultado.estado).toBe('fallido');
    expect(resultado.aprobado).toBe(false);
    expect(resultado.fallosOriginales).toHaveLength(2);
  });

  it('sin ejecuciones registradas no hay aprobación', () => {
    const resultado = evaluarEjecuciones([]);
    expect(resultado.aprobado).toBe(false);
    expect(resultado.estado).toBe('ausente');
  });

  it('ordena por intento aunque lleguen desordenados', () => {
    const resultado = evaluarEjecuciones([
      { intento: 2, resultado: 'correcto' },
      { intento: 1, resultado: 'fallido', causa: 'x' },
    ]);
    expect(resultado.estado).toBe('intermitente');
  });
});
