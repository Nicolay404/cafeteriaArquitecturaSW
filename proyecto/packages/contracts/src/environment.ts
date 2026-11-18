import { assertKnownFields, containsSecret, isRecord } from './secrets.js';

// Entorno (data-model.md, FR-010/011): dónde se despliega un candidato. Guarda REFERENCIAS a la
// configuración y a los secretos, nunca sus valores: «Configuración no contiene valores secretos».
export const ENVIRONMENT_TYPES = ['preview', 'staging', 'production'] as const;
export type EnvironmentType = (typeof ENVIRONMENT_TYPES)[number];

export interface Environment {
  readonly tipo: EnvironmentType;
  /** Número del PR; solo un preview lo lleva. */
  readonly pr?: number;
  readonly url: string;
  readonly region: string;
  /** Nombre de variable → `ref:NOMBRE`, `secret:NOMBRE` o `publico:valor`. */
  readonly configuracion: Readonly<Record<string, string>>;
}

const FIELDS = ['tipo', 'pr', 'url', 'region', 'configuracion'] as const;
const VARIABLE = /^[A-Z][A-Z0-9_]*$/;
const REFERENCE = /^(ref|secret):[A-Z][A-Z0-9_]*$/;
const PUBLIC = /^publico:\S+$/;
const LOOPBACK = ['localhost', '127.0.0.1', '[::1]'];

function url(value: unknown): string {
  if (typeof value !== 'string') throw new Error('url debe ser texto');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('url no es una URL válida');
  }
  const secure =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && LOOPBACK.includes(parsed.hostname));
  if (!secure) throw new Error('url debe usar https (http solo en loopback local)');
  if (parsed.username || parsed.password) throw new Error('url no debe llevar credenciales');
  if (parsed.pathname !== '/' || parsed.search || parsed.hash)
    throw new Error('url debe ser solo el origen, sin ruta ni consulta');
  return parsed.origin;
}

function configuration(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new Error('configuracion debe ser un objeto');
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value)) {
    if (!VARIABLE.test(name)) throw new Error(`Nombre de variable inválido: «${name}»`);
    if (typeof entry !== 'string' || !(REFERENCE.test(entry) || PUBLIC.test(entry)))
      throw new Error(
        `${name} debe ser una referencia (ref:NOMBRE o secret:NOMBRE) o publico:valor, nunca un secreto en claro`,
      );
    if (containsSecret(entry)) throw new Error(`${name} contiene un valor que parece un secreto`);
    result[name] = entry;
  }
  return Object.freeze(result);
}

export function parseEnvironment(input: unknown): Environment {
  if (!isRecord(input)) throw new Error('El entorno debe ser un objeto');
  assertKnownFields(input, FIELDS);

  const tipo = input['tipo'];
  if (typeof tipo !== 'string' || !(ENVIRONMENT_TYPES as readonly string[]).includes(tipo))
    throw new Error(`tipo de entorno inválido; se espera ${ENVIRONMENT_TYPES.join(', ')}`);

  const pr = input['pr'];
  if (tipo === 'preview') {
    if (typeof pr !== 'number' || !Number.isInteger(pr) || pr < 1)
      throw new Error('Un preview exige el número de PR (entero positivo)');
  } else if (pr !== undefined) throw new Error('Solo un preview lleva número de PR');

  const region = input['region'];
  if (typeof region !== 'string' || region.trim() === '') throw new Error('region es obligatoria');

  return Object.freeze({
    tipo: tipo as EnvironmentType,
    ...(typeof pr === 'number' ? { pr } : {}),
    url: url(input['url']),
    region,
    configuracion: configuration(input['configuracion']),
  });
}
