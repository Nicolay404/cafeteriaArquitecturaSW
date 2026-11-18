import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { REPORT_FILES, runQualityGate } from '../../scripts/ci/quality-gate.js';
import type { ReportKind } from '../../scripts/ci/quality-gate.js';

// T024/T027 — el CLI lee informes con NOMBRES FIJOS dentro de una carpeta: ningún argumento
// contiene una ruta ni un nombre de archivo (Sonar: path traversal), y todo lo ausente,
// ilegible o inesperado bloquea.
const sha = 'a'.repeat(40);
const bueno = {
  analysisId: 'AX-1',
  sha,
  cobertura: 85,
  bugs: 0,
  vulnerabilidades: 0,
  hotspotsRevisados: 100,
  duplicacion: 1.5,
  ratings: { mantenibilidad: 'A', fiabilidad: 'A', seguridad: 'A' },
  coberturaModulos: { promociones: 96 },
};
const medidas = (seguridad = '3.0') => ({
  analysisId: 'AX-2',
  sha,
  measures: [
    { metric: 'new_coverage', period: { value: '90' } },
    { metric: 'new_bugs', period: { value: '0' } },
    { metric: 'new_vulnerabilities', period: { value: '0' } },
    { metric: 'new_security_hotspots_reviewed', period: { value: '100' } },
    { metric: 'new_duplicated_lines_density', period: { value: '0' } },
    { metric: 'new_maintainability_rating', period: { value: '1.0' } },
    { metric: 'new_reliability_rating', period: { value: '1.0' } },
    { metric: 'new_security_rating', period: { value: seguridad } },
  ],
});
const trivyAlta = {
  Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-0', Severity: 'HIGH' }] }],
};

describe('CLI de la puerta de calidad', () => {
  const directories: string[] = [];
  afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true });
  });

  /** Ejecuta el CLI con una carpeta de informes nueva que contiene solo los indicados. */
  function run(reports: Partial<Record<ReportKind, unknown>>, ...args: string[]) {
    const dir = mkdtempSync(join(tmpdir(), 'cafeteria-quality-'));
    directories.push(dir);
    for (const [kind, value] of Object.entries(reports))
      writeFileSync(
        join(dir, REPORT_FILES[kind as ReportKind]),
        typeof value === 'string' ? value : JSON.stringify(value),
      );
    const lines: string[] = [];
    const code = runQualityGate(args, { reportsDir: dir, log: (line) => lines.push(line) });
    return { code, text: lines.join('\n') };
  }

  it('aprueba un resultado que cumple los umbrales y sale con 0', () => {
    expect(run({ result: bueno }, '--result', '--sha', sha)).toEqual({
      code: 0,
      text: 'Puerta de calidad: APROBADA',
    });
  });

  it('bloquea con todas las causas y sale con 1', () => {
    const { code, text } = run(
      { result: { ...bueno, cobertura: 60, bugs: 3 } },
      '--result',
      '--sha',
      sha,
    );
    expect(code).toBe(1);
    expect(text).toContain('BLOQUEADA');
    expect(text).toMatch(/Cobertura nueva 60/);
    expect(text).toMatch(/Bugs nuevos: 3/);
  });

  it('un informe ilegible o inexistente cuenta como ausente y bloquea', () => {
    for (const reports of [{ result: '{no es json' }, {}]) {
      const { code, text } = run(reports, '--result', '--sha', sha);
      expect(code).toBe(1);
      expect(text).toContain('se trata como ausente');
    }
  });

  it('sin indicar qué leer la ausencia no significa aprobado', () => {
    const { code, text } = run({ result: bueno }, '--sha', sha);
    expect(code).toBe(1);
    expect(text).toMatch(/ausen/i);
  });

  it('exige el commit que se evalúa', () => {
    const { code, text } = run({ result: bueno }, '--result');
    expect(code).toBe(1);
    expect(text).toContain('--sha');
  });

  it('un análisis de otro commit no aprueba', () => {
    const { code, text } = run({ result: bueno }, '--result', '--sha', 'b'.repeat(40));
    expect(code).toBe(1);
    expect(text).toMatch(/otro commit/);
  });

  it('traduce las métricas de Sonar y aplica la calificación de seguridad', () => {
    const { code, text } = run({ measures: medidas() }, '--measures', '--sha', sha);
    expect(code).toBe(1);
    expect(text).toMatch(/seguridad C/);
    expect(text).not.toMatch(/Cobertura nueva/);
    expect(run({ measures: medidas('1.0') }, '--measures', '--sha', sha).code).toBe(0);
  });

  it('rechaza unas métricas que no son un objeto', () => {
    const { code, text } = run({ measures: ['no', 'objeto'] }, '--measures', '--sha', sha);
    expect(code).toBe(1);
    expect(text).toContain('deben ser un objeto');
  });

  it('un módulo crítico modificado se evalúa con su propio umbral', () => {
    const reports = { result: bueno };
    expect(run(reports, '--result', '--sha', sha, '--modules', 'promociones').code).toBe(0);
    const sinDato = run(reports, '--result', '--sha', sha, '--modules', 'pagos');
    expect(sinDato.code).toBe(1);
    expect(sinDato.text).toMatch(/pagos.*sin dato/);
  });

  it('en un PR solo de documentación la cobertura no aplica', () => {
    const { code, text } = run(
      { result: { ...bueno, cobertura: null } },
      '--result',
      '--sha',
      sha,
      '--docs',
    );
    expect(code).toBe(0);
    expect(text).toContain('No aplica: cobertura');
  });

  it('un secreto o una vulnerabilidad alta bloquean; un informe limpio no', () => {
    expect(run({ result: bueno, gitleaks: [] }, '--result', '--sha', sha, '--gitleaks').code).toBe(
      0,
    );
    const secreto = run(
      { result: bueno, gitleaks: [{ RuleID: 'aws-access-token', File: 'x' }] },
      '--result',
      '--sha',
      sha,
      '--gitleaks',
    );
    expect(secreto.code).toBe(1);
    expect(secreto.text).toMatch(/Secretos detectados: 1/);
    const alta = run({ result: bueno, trivy: trivyAlta }, '--result', '--sha', sha, '--trivy');
    expect(alta.code).toBe(1);
    expect(alta.text).toMatch(/altas o críticas: 1/);
  });

  it('un informe de seguridad ilegible o ausente bloquea', () => {
    for (const reports of [{ result: bueno, trivy: '{roto' }, { result: bueno }]) {
      const { code, text } = run(reports, '--result', '--sha', sha, '--trivy');
      expect(code).toBe(1);
      expect(text).toContain('se trata como ausente');
    }
  });

  it('un argumento desconocido es un error de uso, no una ejecución parcial', () => {
    const { code, text } = run({ result: bueno }, '--result', '--sha', sha, '--inventado', 'x');
    expect(code).toBe(1);
    expect(text).toMatch(/inventado/);
  });

  describe('no hay forma de indicar una ruta', () => {
    it.each([
      ['--result', '../resultado-calidad.json'],
      ['--result', '/etc/passwd'],
      ['--measures', 'C:\\Windows\\win.ini'],
      ['--gitleaks', 'sub/gitleaks.json'],
    ])('«%s %s» se rechaza sin leer nada', (flag, valor) => {
      const { code, text } = run({ result: bueno }, flag, valor, '--sha', sha);
      expect(code).toBe(1);
      expect(text).toMatch(/Unexpected argument|positional|argument/i);
    });

    it('los nombres de los informes son constantes, sin rutas', () => {
      for (const name of Object.values(REPORT_FILES)) expect(name).toMatch(/^[a-z-]+\.json$/);
    });
  });
});
