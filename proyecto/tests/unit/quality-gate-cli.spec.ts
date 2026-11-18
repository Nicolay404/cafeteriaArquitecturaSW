import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reportPath, runQualityGate } from '../../scripts/ci/quality-gate.js';

// T024/T027 — el CLI solo lee informes por NOMBRE dentro de una carpeta fija: un argumento no
// puede apuntar a otra ruta (Sonar: path traversal) y todo lo ausente o ilegible bloquea.
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

describe('CLI de la puerta de calidad', () => {
  let dir = '';
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  const run = (...args: string[]) => {
    const lines: string[] = [];
    const code = runQualityGate(args, { reportsDir: dir, log: (line) => lines.push(line) });
    return { code, text: lines.join('\n') };
  };

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cafeteria-quality-'));
    write('ok.json', bueno);
    write('mal.json', { ...bueno, cobertura: 60, bugs: 3 });
    write('roto.json', '{no es json');
    write('gitleaks-limpio.json', []);
    write('gitleaks-secreto.json', [{ RuleID: 'aws-access-token', File: 'x' }]);
    write('trivy-alta.json', {
      Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-0', Severity: 'HIGH' }] }],
    });
    write('sonar.json', {
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
        { metric: 'new_security_rating', period: { value: '3.0' } },
      ],
    });
    write('metricas-invalidas.json', ['no', 'objeto']);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('aprueba un resultado que cumple los umbrales y sale con 0', () => {
    expect(run('--result', 'ok.json', '--sha', sha)).toEqual({
      code: 0,
      text: 'Puerta de calidad: APROBADA',
    });
  });

  it('bloquea con todas las causas y sale con 1', () => {
    const { code, text } = run('--result', 'mal.json', '--sha', sha);
    expect(code).toBe(1);
    expect(text).toContain('BLOQUEADA');
    expect(text).toMatch(/Cobertura nueva 60/);
    expect(text).toMatch(/Bugs nuevos: 3/);
  });

  it('un informe ilegible o inexistente cuenta como ausente y bloquea', () => {
    for (const name of ['roto.json', 'no-existe.json']) {
      const { code, text } = run('--result', name, '--sha', sha);
      expect(code).toBe(1);
      expect(text).toContain('se trata como ausente');
    }
  });

  it('sin resultado ni métricas la ausencia no significa aprobado', () => {
    const { code, text } = run('--sha', sha);
    expect(code).toBe(1);
    expect(text).toMatch(/ausen/i);
  });

  it('exige el commit que se evalúa', () => {
    expect(run('--result', 'ok.json')).toMatchObject({ code: 1 });
    expect(run('--result', 'ok.json').text).toContain('--sha');
  });

  it('un análisis de otro commit no aprueba', () => {
    const { code, text } = run('--result', 'ok.json', '--sha', 'b'.repeat(40));
    expect(code).toBe(1);
    expect(text).toMatch(/otro commit/);
  });

  it('traduce las métricas de Sonar y aplica la calificación de seguridad', () => {
    const { code, text } = run('--measures', 'sonar.json', '--sha', sha);
    expect(code).toBe(1);
    expect(text).toMatch(/seguridad C/);
    expect(text).not.toMatch(/Cobertura nueva/);
  });

  it('rechaza unas métricas que no son un objeto', () => {
    const { code, text } = run('--measures', 'metricas-invalidas.json', '--sha', sha);
    expect(code).toBe(1);
    expect(text).toContain('deben ser un objeto');
  });

  it('un módulo crítico modificado se evalúa con su propio umbral', () => {
    expect(run('--result', 'ok.json', '--sha', sha, '--modules', 'promociones').code).toBe(0);
    const sinDato = run('--result', 'ok.json', '--sha', sha, '--modules', 'pagos');
    expect(sinDato.code).toBe(1);
    expect(sinDato.text).toMatch(/pagos.*sin dato/);
  });

  it('en un PR solo de documentación la cobertura no aplica', () => {
    write('doc.json', { ...bueno, cobertura: null });
    const { code, text } = run('--result', 'doc.json', '--sha', sha, '--docs');
    expect(code).toBe(0);
    expect(text).toContain('No aplica: cobertura');
  });

  it('un secreto o una vulnerabilidad alta bloquean; un informe limpio no', () => {
    expect(
      run('--result', 'ok.json', '--sha', sha, '--gitleaks', 'gitleaks-limpio.json').code,
    ).toBe(0);
    const secreto = run('--result', 'ok.json', '--sha', sha, '--gitleaks', 'gitleaks-secreto.json');
    expect(secreto.code).toBe(1);
    expect(secreto.text).toMatch(/Secretos detectados: 1/);
    const alta = run('--result', 'ok.json', '--sha', sha, '--trivy', 'trivy-alta.json');
    expect(alta.code).toBe(1);
    expect(alta.text).toMatch(/altas o críticas: 1/);
  });

  it('un informe de seguridad ilegible bloquea', () => {
    const { code, text } = run('--result', 'ok.json', '--sha', sha, '--trivy', 'roto.json');
    expect(code).toBe(1);
    expect(text).toContain('se trata como ausente');
  });

  it('un argumento desconocido es un error de uso, no una ejecución parcial', () => {
    const { code, text } = run('--result', 'ok.json', '--sha', sha, '--inventado', 'x');
    expect(code).toBe(1);
    expect(text).toMatch(/inventado/);
  });

  describe('nombres de informe', () => {
    it.each([
      '../secreto.json',
      '..\\secreto.json',
      'sub/informe.json',
      '/etc/passwd',
      'C:\\Windows\\win.json',
      'informe.txt',
      '..json',
      'a..b.json',
      '',
      '.oculto.json',
    ])('rechaza «%s» sin leer nada', (name) => {
      expect(() => reportPath('/seguro', name)).toThrow(/no válido/);
    });

    it('acepta un nombre simple y lo deja dentro de la carpeta', () => {
      expect(reportPath('/seguro', 'sonar-pr4.json')).toBe(join('/seguro', 'sonar-pr4.json'));
    });

    it('el CLI rechaza una ruta en --result y no la lee', () => {
      const { code, text } = run('--result', '../ok.json', '--sha', sha);
      expect(code).toBe(1);
      expect(text).toMatch(/no válido/);
    });
  });
});
