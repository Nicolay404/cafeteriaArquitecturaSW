import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// FR-006/007/008 y Constitución VI: umbral de calidad sobre el código NUEVO de cada PR.
// Falla cerrado: la ausencia de un resultado (Sonar caído, informe vacío, métrica faltante,
// análisis de otro commit) nunca significa aprobado. Bajar un umbral exige enmendar la constitución.
export const THRESHOLDS = {
  cobertura: 80,
  coberturaCritica: 95,
  bugs: 0,
  vulnerabilidades: 0,
  hotspotsRevisados: 100,
  duplicacionMaxima: 3,
  rating: 'A',
  modulosCriticos: ['promociones', 'pedidos', 'pagos'],
} as const;

const RATINGS = ['A', 'B', 'C', 'D', 'E'] as const;
export type Rating = (typeof RATINGS)[number];

export interface ResultadoCalidad {
  analysisId: string;
  sha: string;
  /** Cobertura del código nuevo, 0–100. `null` = no disponible (p. ej. solo documentación). */
  cobertura: number | null;
  bugs: number;
  vulnerabilidades: number;
  hotspotsRevisados: number;
  duplicacion: number;
  ratings: { mantenibilidad: Rating; fiabilidad: Rating; seguridad: Rating };
  coberturaModulos: Record<string, number>;
}

export interface Evaluacion {
  aprobado: boolean;
  razones: string[];
  noAplica: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function percentage(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100)
    throw new Error(`${name} debe ser un número entre 0 y 100`);
  return value;
}

function count(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
    throw new Error(`${name} debe ser un entero mayor o igual que 0`);
  return value;
}

function rating(value: unknown, name: string): Rating {
  if (typeof value !== 'string' || !(RATINGS as readonly string[]).includes(value))
    throw new Error(`${name} debe ser una calificación de A a E`);
  return value as Rating;
}

export function parseResultadoCalidad(input: unknown): ResultadoCalidad {
  if (!isRecord(input)) throw new Error('El resultado de calidad debe ser un objeto');
  const { analysisId, sha, ratings, coberturaModulos } = input;
  if (typeof analysisId !== 'string' || analysisId.trim() === '')
    throw new Error('analysisId es obligatorio');
  if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/.test(sha))
    throw new Error('sha debe ser un SHA completo de 40 caracteres hexadecimales');
  if (!isRecord(ratings)) throw new Error('ratings es obligatorio');
  const modules: Record<string, number> = {};
  if (coberturaModulos !== undefined) {
    if (!isRecord(coberturaModulos)) throw new Error('coberturaModulos debe ser un objeto');
    for (const [name, value] of Object.entries(coberturaModulos))
      modules[name] = percentage(value, `Cobertura del módulo ${name}`);
  }
  return {
    analysisId,
    sha,
    cobertura: input.cobertura === null ? null : percentage(input.cobertura, 'cobertura'),
    bugs: count(input.bugs, 'bugs'),
    vulnerabilidades: count(input.vulnerabilidades, 'vulnerabilidades'),
    hotspotsRevisados: percentage(input.hotspotsRevisados, 'hotspotsRevisados'),
    duplicacion: percentage(input.duplicacion, 'duplicacion'),
    ratings: {
      mantenibilidad: rating(ratings.mantenibilidad, 'ratings.mantenibilidad'),
      fiabilidad: rating(ratings.fiabilidad, 'ratings.fiabilidad'),
      seguridad: rating(ratings.seguridad, 'ratings.seguridad'),
    },
    coberturaModulos: modules,
  };
}

export function evaluarCalidad(
  resultado: ResultadoCalidad | null | undefined,
  contexto: { sha: string; modulosCambiados?: string[]; soloDocumentacion?: boolean },
): Evaluacion {
  if (!resultado)
    return {
      aprobado: false,
      razones: ['Resultado de Sonar ausente: la ausencia no significa aprobado'],
      noAplica: [],
    };
  const razones: string[] = [];
  const noAplica: string[] = [];
  if (resultado.sha !== contexto.sha)
    razones.push(
      `El análisis corresponde a otro commit (${resultado.sha.slice(0, 7)}), no a ${contexto.sha.slice(0, 7)}`,
    );

  if (contexto.soloDocumentacion) noAplica.push('cobertura');
  else if (resultado.cobertura === null)
    razones.push('Cobertura sin dato en un cambio de código: no se da por buena');
  else if (resultado.cobertura < THRESHOLDS.cobertura)
    razones.push(`Cobertura nueva ${resultado.cobertura} % < ${THRESHOLDS.cobertura} %`);

  if (!contexto.soloDocumentacion)
    for (const modulo of contexto.modulosCambiados ?? []) {
      if (!(THRESHOLDS.modulosCriticos as readonly string[]).includes(modulo)) continue;
      const valor = resultado.coberturaModulos[modulo];
      if (valor === undefined)
        razones.push(`Módulo crítico ${modulo} modificado sin dato de cobertura`);
      else if (valor < THRESHOLDS.coberturaCritica)
        razones.push(
          `Cobertura del módulo ${modulo} ${valor} % < ${THRESHOLDS.coberturaCritica} %`,
        );
    }

  if (resultado.bugs > THRESHOLDS.bugs)
    razones.push(`Bugs nuevos: ${resultado.bugs} (máximo ${THRESHOLDS.bugs})`);
  if (resultado.vulnerabilidades > THRESHOLDS.vulnerabilidades)
    razones.push(
      `Vulnerabilidades nuevas: ${resultado.vulnerabilidades} (máximo ${THRESHOLDS.vulnerabilidades})`,
    );
  if (resultado.hotspotsRevisados < THRESHOLDS.hotspotsRevisados)
    razones.push(
      `Hotspots de seguridad revisados: ${resultado.hotspotsRevisados} % (mínimo ${THRESHOLDS.hotspotsRevisados} %)`,
    );
  if (resultado.duplicacion >= THRESHOLDS.duplicacionMaxima)
    razones.push(
      `Duplicación ${resultado.duplicacion} % (debe ser menor que ${THRESHOLDS.duplicacionMaxima} %)`,
    );
  for (const [nombre, valor] of Object.entries(resultado.ratings))
    if (valor !== THRESHOLDS.rating)
      razones.push(`Calificación de ${nombre} ${valor} (mínimo ${THRESHOLDS.rating})`);

  return { aprobado: razones.length === 0, razones, noAplica };
}

/** Sonar entrega las calificaciones como 1.0–5.0. */
const RATING_BY_NUMBER: Record<string, Rating> = {
  '1': 'A',
  '2': 'B',
  '3': 'C',
  '4': 'D',
  '5': 'E',
};

interface SonarMeasure {
  metric: string;
  value?: string;
  period?: { value?: string };
  periods?: Array<{ value?: string }>;
}

export function fromSonarMeasures(input: {
  analysisId: string;
  sha: string;
  measures: SonarMeasure[];
  coberturaModulos?: Record<string, number>;
}): ResultadoCalidad {
  const read = (metric: string): string | undefined => {
    const measure = input.measures.find((item) => item.metric === metric);
    return measure?.period?.value ?? measure?.periods?.[0]?.value ?? measure?.value;
  };
  const required = (metric: string): string => {
    const value = read(metric);
    if (value === undefined) throw new Error(`Métrica ausente en el informe de Sonar: ${metric}`);
    return value;
  };
  const toRating = (metric: string): Rating => {
    const mapped = RATING_BY_NUMBER[String(Math.trunc(Number(required(metric))))];
    if (!mapped) throw new Error(`Calificación inválida en ${metric}`);
    return mapped;
  };
  const coverage = read('new_coverage');
  return parseResultadoCalidad({
    analysisId: input.analysisId,
    sha: input.sha,
    cobertura: coverage === undefined ? null : Number(coverage),
    bugs: Number(required('new_bugs')),
    vulnerabilidades: Number(required('new_vulnerabilities')),
    hotspotsRevisados: Number(required('new_security_hotspots_reviewed')),
    duplicacion: Number(required('new_duplicated_lines_density')),
    ratings: {
      mantenibilidad: toRating('new_maintainability_rating'),
      fiabilidad: toRating('new_reliability_rating'),
      seguridad: toRating('new_security_rating'),
    },
    coberturaModulos: input.coberturaModulos ?? {},
  });
}

// ---- Seguridad: secretos y vulnerabilidades altas o críticas bloquean ----

export function contarHallazgosGitleaks(informe: unknown): number {
  if (!Array.isArray(informe)) throw new Error('El informe de Gitleaks debe ser una lista');
  return informe.length;
}

export function contarHallazgosTrivy(informe: unknown): number {
  if (!isRecord(informe)) throw new Error('El informe de Trivy debe ser un objeto');
  const results = informe['Results'];
  if (results === undefined || results === null) return 0;
  if (!Array.isArray(results)) throw new Error('El informe de Trivy tiene Results inválido');
  let total = 0;
  for (const result of results) {
    const found = isRecord(result) ? result['Vulnerabilities'] : undefined;
    if (!Array.isArray(found)) continue;
    total += found.filter(
      (item) => isRecord(item) && (item['Severity'] === 'HIGH' || item['Severity'] === 'CRITICAL'),
    ).length;
  }
  return total;
}

export function evaluarSeguridad(
  hallazgos: { secretos: number; altasCriticas: number } | null | undefined,
): Evaluacion {
  if (!hallazgos)
    return {
      aprobado: false,
      razones: ['Informe de seguridad ausente: la ausencia no significa aprobado'],
      noAplica: [],
    };
  const razones: string[] = [];
  if (hallazgos.secretos > 0) razones.push(`Secretos detectados: ${hallazgos.secretos}`);
  if (hallazgos.altasCriticas > 0)
    razones.push(`Vulnerabilidades altas o críticas: ${hallazgos.altasCriticas}`);
  return { aprobado: razones.length === 0, razones, noAplica: [] };
}

// ---- Ejecuciones: un reintento verde no borra el fallo original ----

export interface Intento {
  intento: number;
  resultado: 'correcto' | 'fallido';
  causa?: string;
}

export interface EvaluacionEjecuciones {
  estado: 'correcto' | 'fallido' | 'intermitente' | 'ausente';
  aprobado: boolean;
  fallosOriginales: Intento[];
  razones: string[];
}

export function evaluarEjecuciones(intentos: Intento[]): EvaluacionEjecuciones {
  const ordenados = [...intentos].sort((a, b) => a.intento - b.intento);
  const fallos = ordenados.filter((item) => item.resultado === 'fallido');
  const ultimo = ordenados.at(-1);
  if (!ultimo)
    return {
      estado: 'ausente',
      aprobado: false,
      fallosOriginales: [],
      razones: ['Sin ejecuciones registradas: no hay aprobación'],
    };
  if (ultimo.resultado === 'fallido')
    return {
      estado: 'fallido',
      aprobado: false,
      fallosOriginales: fallos,
      razones: fallos.map((item) => `Intento ${item.intento} falló: ${item.causa ?? 'sin causa'}`),
    };
  if (fallos.length > 0) {
    const primero = fallos[0]!;
    return {
      estado: 'intermitente',
      aprobado: false,
      fallosOriginales: fallos,
      razones: [
        `Fallo intermitente: el intento ${primero.intento} falló (${primero.causa ?? 'sin causa'}) y un reintento pasó; investígalo antes de integrar`,
      ],
    };
  }
  return { estado: 'correcto', aprobado: true, fallosOriginales: [], razones: [] };
}

// ---- CLI ----

function readJson(path: string, name: string): unknown {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf8')) as unknown;
  } catch {
    throw new Error(`No se pudo leer ${name} (${path}): se trata como ausente`);
  }
}

function main() {
  const { values } = parseArgs({
    options: {
      result: { type: 'string' },
      measures: { type: 'string' },
      sha: { type: 'string' },
      modules: { type: 'string', default: '' },
      docs: { type: 'boolean', default: false },
      gitleaks: { type: 'string' },
      trivy: { type: 'string' },
    },
  });
  if (!values.sha) throw new Error('Falta --sha: el commit que se evalúa');
  const razones: string[] = [];
  let aprobado = true;
  const apply = (evaluacion: Evaluacion) => {
    aprobado &&= evaluacion.aprobado;
    razones.push(...evaluacion.razones);
    for (const item of evaluacion.noAplica) console.log(`No aplica: ${item}`);
  };

  let resultado: ResultadoCalidad | undefined;
  try {
    if (values.result) resultado = parseResultadoCalidad(readJson(values.result, 'el resultado'));
    else if (values.measures) {
      const raw = readJson(values.measures, 'las métricas');
      if (!isRecord(raw)) throw new Error('Las métricas de Sonar deben ser un objeto');
      resultado = fromSonarMeasures(raw as Parameters<typeof fromSonarMeasures>[0]);
    }
  } catch (error) {
    razones.push(error instanceof Error ? error.message : 'Resultado de Sonar no válido');
    aprobado = false;
  }
  if (aprobado || resultado)
    apply(
      evaluarCalidad(resultado, {
        sha: values.sha,
        modulosCambiados: values.modules!.split(',').filter(Boolean),
        soloDocumentacion: values.docs!,
      }),
    );

  if (values.gitleaks || values.trivy) {
    try {
      apply(
        evaluarSeguridad({
          secretos: values.gitleaks
            ? contarHallazgosGitleaks(readJson(values.gitleaks, 'el informe de Gitleaks'))
            : 0,
          altasCriticas: values.trivy
            ? contarHallazgosTrivy(readJson(values.trivy, 'el informe de Trivy'))
            : 0,
        }),
      );
    } catch (error) {
      razones.push(error instanceof Error ? error.message : 'Informe de seguridad no válido');
      aprobado = false;
    }
  }

  if (aprobado) console.log('Puerta de calidad: APROBADA');
  else {
    console.log('Puerta de calidad: BLOQUEADA');
    for (const razon of [...new Set(razones)]) console.log(`  - ${razon}`);
  }
  process.exitCode = aprobado ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo evaluar la calidad');
    process.exitCode = 1;
  }
}
