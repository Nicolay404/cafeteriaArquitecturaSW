import { describe, expect, it } from 'vitest';
import { classifyChange } from '../../../scripts/ci/verify-commits.js';

// T023/T026 — qué comprobaciones exige cada commit según los archivos que toca.
describe('clasificación de los cambios de un commit', () => {
  it('un PR solo de documentación no exige compilar ni probar la aplicación', () => {
    expect(classifyChange(['README.md', 'specs/001/tasks.md', 'proyecto/docs/guia.md'])).toBe(
      'documentacion',
    );
    expect(classifyChange([])).toBe('documentacion');
  });

  it('un cambio solo de aplicación verifica lo afectado', () => {
    expect(
      classifyChange([
        'proyecto/apps/api/src/modules/pedidos/index.ts',
        'proyecto/tests/unit/x.spec.ts',
        'specs/001/tasks.md',
      ]),
    ).toBe('aplicacion');
  });

  it.each([
    'proyecto/package.json',
    'proyecto/pnpm-lock.yaml',
    'proyecto/pnpm-workspace.yaml',
    'proyecto/turbo.json',
    'proyecto/tsconfig.json',
    'proyecto/packages/config/tsconfig.base.json',
    'proyecto/infra/compose.yaml',
    '.github/workflows/pr-quality.yml',
    '.husky/pre-commit',
    'scripts/ci/verify-commits.ts',
    '.gitignore',
  ])('un cambio en %s verifica todo', (file) => {
    expect(classifyChange(['proyecto/apps/api/src/main.ts', file])).toBe('raiz');
  });

  it('ante un archivo desconocido comprueba todo, nunca menos', () => {
    expect(classifyChange(['archivo-nuevo.xyz'])).toBe('raiz');
  });
});
