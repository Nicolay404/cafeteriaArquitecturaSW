import { createHash } from 'node:crypto';
import { assertKnownFields, containsSecret, isRecord } from './secrets.js';

// Candidato (data-model.md, FR-012): el paquete que se promueve INTACTO entre entornos.
// Se identifica por su contenido (SHA, digests de imagen, hash de la web, checksums de las
// migraciones y revisión de la configuración), nunca por un tag mutable, y no lleva secretos.
export interface Candidate {
  readonly sha: string;
  readonly digestApi: string;
  readonly digestWorker: string;
  readonly hashWeb: string;
  readonly migrationChecksums: Readonly<Record<string, string>>;
  readonly configRevision: string;
  readonly reportRefs: readonly string[];
}

const FIELDS = [
  'sha',
  'digestApi',
  'digestWorker',
  'hashWeb',
  'migrationChecksums',
  'configRevision',
  'reportRefs',
  'id',
] as const;

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const CHECKSUM = /^[0-9a-f]{64}$/;
const MIGRATION_VERSION = /^[0-9]{3}$/;

function digest(value: unknown, name: string): string {
  if (typeof value !== 'string' || !DIGEST.test(value))
    throw new Error(`${name} debe ser un digest sha256:<64 hex>, no un tag mutable`);
  return value;
}

function noSecret(value: string, name: string): string {
  if (containsSecret(value)) throw new Error(`${name} contiene un valor que parece un secreto`);
  return value;
}

function reportRef(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Cada referencia de informe debe ser texto');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Cada referencia de informe debe ser una URL https');
  }
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Cada referencia de informe debe ser una URL https sin credenciales');
  return noSecret(value, 'La referencia de informe');
}

export function parseCandidate(input: unknown): Candidate {
  if (!isRecord(input)) throw new Error('El candidato debe ser un objeto');
  assertKnownFields(input, FIELDS);

  if (typeof input['sha'] !== 'string' || !SHA.test(input['sha']))
    throw new Error('sha debe ser un SHA completo de 40 caracteres hexadecimales en minúsculas');

  const checksums = input['migrationChecksums'];
  if (!isRecord(checksums)) throw new Error('migrationChecksums debe ser un objeto');
  const migrationChecksums: Record<string, string> = {};
  for (const [version, checksum] of Object.entries(checksums)) {
    if (!MIGRATION_VERSION.test(version))
      throw new Error(`Versión de migración inválida: «${version}» (se espera NNN)`);
    if (typeof checksum !== 'string' || !CHECKSUM.test(checksum))
      throw new Error(`El checksum de la migración ${version} debe ser sha256 en hexadecimal`);
    migrationChecksums[version] = checksum;
  }

  const revision = input['configRevision'];
  if (typeof revision !== 'string' || revision.trim() === '')
    throw new Error('configRevision es obligatoria');

  const refs = input['reportRefs'];
  if (!Array.isArray(refs)) throw new Error('reportRefs debe ser una lista');

  const candidate: Candidate = Object.freeze({
    sha: input['sha'],
    digestApi: digest(input['digestApi'], 'digestApi'),
    digestWorker: digest(input['digestWorker'], 'digestWorker'),
    hashWeb: digest(input['hashWeb'], 'hashWeb'),
    migrationChecksums: Object.freeze(migrationChecksums),
    configRevision: noSecret(revision, 'configRevision'),
    reportRefs: Object.freeze(refs.map(reportRef)),
  });

  if (input['id'] !== undefined && input['id'] !== candidateId(candidate))
    throw new Error('El id del manifiesto no coincide con su contenido');
  return candidate;
}

/** Construye un candidato validado e inmutable a partir de sus partes. */
export const buildCandidate = (parts: unknown): Candidate => parseCandidate(parts);

/** Identificador derivado SOLO del contenido: mismo contenido, mismo id. */
export function candidateId(candidate: Candidate): string {
  const canonical = JSON.stringify({
    sha: candidate.sha,
    digestApi: candidate.digestApi,
    digestWorker: candidate.digestWorker,
    hashWeb: candidate.hashWeb,
    migrationChecksums: Object.fromEntries(
      Object.entries(candidate.migrationChecksums).sort(([a], [b]) => a.localeCompare(b, 'en')),
    ),
    configRevision: candidate.configRevision,
    reportRefs: candidate.reportRefs,
  });
  return `cand-${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}
