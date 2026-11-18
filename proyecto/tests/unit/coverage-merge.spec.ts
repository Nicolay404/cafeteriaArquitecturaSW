import { describe, expect, it } from 'vitest';
import { mergeLcov } from '../../scripts/coverage-merge.js';

const root = 'C:\\repo\\proyecto';

function record(file: string, body: string[]) {
  return ['TN:', `SF:${file}`, ...body, 'end_of_record'].join('\n');
}

describe('T016 — LCOV normalizado', () => {
  it('fusiona el mismo archivo de varios informes en un solo registro sin duplicar líneas', () => {
    const unit = record('C:\\repo\\proyecto\\apps\\api\\src\\platform\\health.service.ts', [
      'FN:10,ready',
      'FNDA:1,ready',
      'DA:10,1',
      'DA:11,0',
      'BRDA:11,0,0,1',
      'BRDA:11,0,1,0',
    ]);
    const integration = record('apps/api/src/platform/health.service.ts', [
      'FN:10,ready',
      'FNDA:2,ready',
      'FN:20,postgres',
      'FNDA:0,postgres',
      'DA:11,3',
      'DA:20,0',
      'BRDA:11,0,1,-',
    ]);

    const merged = mergeLcov([unit, integration], root);

    expect(merged.match(/^SF:/gm)).toHaveLength(1);
    expect(merged).toContain('SF:apps/api/src/platform/health.service.ts');
    expect(merged).toContain('DA:10,1');
    expect(merged).toContain('DA:11,3');
    expect(merged).toContain('DA:20,0');
    expect(merged.match(/^DA:11,/gm)).toHaveLength(1);
    expect(merged).toContain('FNDA:3,ready');
    expect(merged).toContain('FNDA:0,postgres');
    expect(merged).toContain('BRDA:11,0,0,1');
    expect(merged).toContain('BRDA:11,0,1,0');
    expect(merged).toContain('LF:3\nLH:2');
    expect(merged).toContain('FNF:2\nFNH:1');
    expect(merged).toContain('BRF:2\nBRH:1');
  });

  it('excluye pruebas, dependencias, generados y archivos fuera del workspace', () => {
    const files = [
      'tests/integration/health.int.spec.ts',
      'apps/web/src/app/page.spec.tsx',
      'node_modules/pg/lib/client.js',
      'apps/web/.next/server/app/page.js',
      'apps/api/dist/apps/api/src/main.js',
      'apps/web/next-env.d.ts',
      'C:\\otro\\fuera.ts',
      'apps/web/src/app/page.tsx',
    ];
    const merged = mergeLcov(
      files.map((file) => record(file, ['DA:1,1'])),
      root,
    );
    expect(merged.match(/^SF:.*$/gm)).toEqual(['SF:apps/web/src/app/page.tsx']);
  });

  it('ordena los archivos y falla si no queda cobertura que informar', () => {
    const merged = mergeLcov(
      [record('scripts/dev.ts', ['DA:1,0']), record('apps/api/src/main.ts', ['DA:1,1'])],
      root,
    );
    expect(merged.match(/^SF:.*$/gm)).toEqual(['SF:apps/api/src/main.ts', 'SF:scripts/dev.ts']);
    expect(() => mergeLcov([record('tests/unit/x.spec.ts', ['DA:1,1'])], root)).toThrow(
      'Sin cobertura',
    );
  });
});
