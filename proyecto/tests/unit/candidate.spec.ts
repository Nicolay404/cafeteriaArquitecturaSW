import { describe, expect, it } from 'vitest';
import {
  buildCandidate,
  candidateId,
  parseCandidate,
} from '../../packages/contracts/src/candidate.js';
import { parseEnvironment } from '../../packages/contracts/src/environment.js';

// T041 — FR-010/011/012 y data-model.md. Un Candidato es el paquete que se promueve intacto
// entre entornos: inmutable, identificado por contenido y SIN secretos dentro. Un Entorno solo
// guarda REFERENCIAS a la configuración y a los secretos, nunca sus valores.
const sha = 'a'.repeat(40);
const digest = (char: string) => `sha256:${char.repeat(64)}`;

const base = () => ({
  sha,
  digestApi: digest('1'),
  digestWorker: digest('2'),
  digestWeb: digest('4'),
  hashWeb: digest('3'),
  migrationChecksums: { '001': 'b'.repeat(64) },
  configRevision: 'rev-2026-11-18',
  reportRefs: ['https://github.com/Nicolay404/cafeteriaArquitecturaSW/actions/runs/1'],
});

describe('Candidato', () => {
  it('se construye desde sus partes y queda inmutable', () => {
    const candidate = buildCandidate(base());
    expect(candidate.sha).toBe(sha);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.migrationChecksums)).toBe(true);
    expect(Object.isFrozen(candidate.reportRefs)).toBe(true);
    expect(() => {
      (candidate as { sha: string }).sha = 'b'.repeat(40);
    }).toThrow();
    expect(() => (candidate.reportRefs as string[]).push('x')).toThrow();
  });

  it('su identificador depende solo del contenido: igual contenido, igual id', () => {
    const one = candidateId(buildCandidate(base()));
    const two = candidateId(buildCandidate(base()));
    expect(one).toBe(two);
    expect(one).toMatch(/^cand-[0-9a-f]{12}$/);
  });

  it('cualquier cambio de contenido cambia el identificador', () => {
    const original = candidateId(buildCandidate(base()));
    for (const change of [
      { sha: 'c'.repeat(40) },
      { digestApi: digest('9') },
      { digestWorker: digest('9') },
      { digestWeb: digest('9') },
      { hashWeb: digest('9') },
      { migrationChecksums: { '001': 'c'.repeat(64) } },
      { configRevision: 'otra' },
    ])
      expect(candidateId(buildCandidate({ ...base(), ...change }))).not.toBe(original);
  });

  it('el orden de las claves de las migraciones no altera el identificador', () => {
    const a = buildCandidate({
      ...base(),
      migrationChecksums: { '001': 'a'.repeat(64), '002': 'b'.repeat(64) },
    });
    const b = buildCandidate({
      ...base(),
      migrationChecksums: { '002': 'b'.repeat(64), '001': 'a'.repeat(64) },
    });
    expect(candidateId(a)).toBe(candidateId(b));
  });

  it('un manifiesto serializado se vuelve a leer idéntico', () => {
    const original = buildCandidate(base());
    const read = parseCandidate(
      JSON.parse(JSON.stringify({ ...original, id: candidateId(original) })),
    );
    expect(candidateId(read)).toBe(candidateId(original));
  });

  it('rechaza un manifiesto cuyo id no corresponde a su contenido (alterado)', () => {
    const original = buildCandidate(base());
    const manifest = { ...original, id: candidateId(original) };
    expect(() => parseCandidate({ ...manifest, id: 'cand-000000000000' })).toThrow(/id/i);
    expect(() => parseCandidate({ ...manifest, sha: 'd'.repeat(40) })).toThrow(/id/i);
  });

  it.each([
    ['SHA corto', { sha: 'abc123' }],
    ['SHA con mayúsculas', { sha: 'A'.repeat(40) }],
    ['digest de la API sin algoritmo', { digestApi: '1'.repeat(64) }],
    ['digest de la API con tag mutable', { digestApi: 'api:latest' }],
    ['digest del worker corto', { digestWorker: 'sha256:abc' }],
    ['digest de la web con tag mutable', { digestWeb: 'web:latest' }],
    ['hash web inválido', { hashWeb: 'sha256:xyz' }],
    ['checksum de migración corto', { migrationChecksums: { '001': 'abc' } }],
    ['versión de migración mal formada', { migrationChecksums: { uno: 'a'.repeat(64) } }],
    ['revisión de configuración vacía', { configRevision: '   ' }],
    ['informe que no es una URL https', { reportRefs: ['file:///etc/passwd'] }],
    ['informe con credenciales', { reportRefs: ['https://usuario:clave@ejemplo.test/x'] }],
  ])('rechaza %s', (_nombre, change) => {
    expect(() => buildCandidate({ ...base(), ...change })).toThrow();
  });

  it('rechaza una imagen identificada por un tag mutable en lugar de por digest', () => {
    for (const tag of ['latest', 'main', 'v1.2.3', 'api:latest', 'ghcr.io/org/api:1.0'])
      expect(() => buildCandidate({ ...base(), digestApi: tag })).toThrow(/digest/i);
  });

  it('rechaza valores que parecen secretos dentro del candidato', () => {
    const secrets = [
      'ghp_' + 'aB3dE5gH7jK9mN2pQ4rS6tV8wX0yZ1cF3hJ5',
      'AKIA' + 'ABCDEFGHIJKLMNOP',
      '-----BEGIN PRIVATE KEY-----',
      'postgresql://usuario:clave@host:5432/base',
    ];
    for (const secret of secrets) {
      expect(() => buildCandidate({ ...base(), configRevision: secret })).toThrow(/secreto/i);
      expect(() =>
        buildCandidate({ ...base(), reportRefs: [`https://x.test/?t=${secret}`] }),
      ).toThrow();
    }
  });

  it('rechaza campos que no forman parte del contrato', () => {
    expect(() => parseCandidate({ ...base(), apiKey: 'x' })).toThrow(/campo/i);
    expect(() => parseCandidate({ ...base(), password: 'x' })).toThrow(/campo/i);
  });

  it('rechaza lo que no es un objeto', () => {
    for (const value of [null, undefined, 'texto', 42, [], true])
      expect(() => parseCandidate(value)).toThrow();
  });
});

describe('Entorno', () => {
  const env = (overrides: Record<string, unknown> = {}) => ({
    tipo: 'staging',
    url: 'https://staging.ejemplo.test',
    region: 'local',
    configuracion: {
      API_BASE_URL: 'ref:API_BASE_URL',
      DATABASE_URL: 'secret:DATABASE_URL',
      APP_ENV: 'publico:staging',
    },
    ...overrides,
  });

  it('acepta un entorno con referencias a la configuración y a los secretos', () => {
    const parsed = parseEnvironment(env());
    expect(parsed.tipo).toBe('staging');
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed.configuracion['DATABASE_URL']).toBe('secret:DATABASE_URL');
  });

  it('un preview exige el número del PR y los demás no lo admiten', () => {
    expect(parseEnvironment(env({ tipo: 'preview', pr: 12 })).pr).toBe(12);
    expect(() => parseEnvironment(env({ tipo: 'preview' }))).toThrow(/PR/);
    expect(() => parseEnvironment(env({ tipo: 'preview', pr: 0 }))).toThrow();
    expect(() => parseEnvironment(env({ tipo: 'preview', pr: 1.5 }))).toThrow();
    expect(() => parseEnvironment(env({ tipo: 'staging', pr: 3 }))).toThrow(/PR/);
    expect(() => parseEnvironment(env({ tipo: 'production', pr: 3 }))).toThrow(/PR/);
  });

  it.each(['desarrollo', 'qa', '', 'PRODUCTION'])('rechaza el tipo «%s»', (tipo) => {
    expect(() => parseEnvironment(env({ tipo }))).toThrow(/tipo/i);
  });

  it('no admite valores secretos en la configuración, solo referencias', () => {
    for (const value of [
      'postgresql://usuario:clave@host/base',
      'ghp_' + 'aB3dE5gH7jK9mN2pQ4rS6tV8wX0yZ1cF3hJ5',
      'clave-en-claro-123',
    ])
      expect(() => parseEnvironment(env({ configuracion: { DATABASE_URL: value } }))).toThrow(
        /referencia|secreto/i,
      );
  });

  it('rechaza nombres de variable o referencias mal formados', () => {
    expect(() =>
      parseEnvironment(env({ configuracion: { 'nombre inválido': 'ref:X' } })),
    ).toThrow();
    expect(() => parseEnvironment(env({ configuracion: { X: 'ref:' } }))).toThrow();
    expect(() => parseEnvironment(env({ configuracion: { X: 'ref:con espacio' } }))).toThrow();
  });

  it.each([
    ['URL sin https', { url: 'http://staging.ejemplo.test' }],
    ['URL con credenciales', { url: 'https://u:p@staging.ejemplo.test' }],
    ['URL con ruta o consulta', { url: 'https://staging.ejemplo.test/x?y=1' }],
    ['región vacía', { region: '' }],
  ])('rechaza %s', (_nombre, change) => {
    expect(() => parseEnvironment(env(change))).toThrow();
  });

  it('permite la URL local de un entorno local por http en loopback', () => {
    expect(parseEnvironment(env({ tipo: 'staging', url: 'http://127.0.0.1:3000' })).url).toBe(
      'http://127.0.0.1:3000',
    );
  });

  it('rechaza campos desconocidos y lo que no es un objeto', () => {
    expect(() => parseEnvironment({ ...env(), token: 'x' })).toThrow(/campo/i);
    for (const value of [null, 'x', 1, []]) expect(() => parseEnvironment(value)).toThrow();
  });
});
