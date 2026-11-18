import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// T059 — la configuración de versionado: SemVer desde Conventional Commits, sin etiquetas desde
// una máquina personal y con acciones fijadas por SHA, igual que el resto de los workflows.
const root = join(import.meta.dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('release-please', () => {
  const config = JSON.parse(read('release-please-config.json')) as {
    'release-type': string;
    packages: Record<string, { 'package-name': string }>;
  };
  const manifest = JSON.parse(read('.release-please-manifest.json')) as Record<string, string>;

  it('versiona el paquete proyecto/ con el tipo node', () => {
    expect(config['release-type']).toBe('node');
    expect(Object.keys(config.packages)).toEqual(['proyecto']);
  });

  it('el primer release es 0.1.0 (en desarrollo), no 1.0.0 (API estable)', () => {
    expect((config as unknown as Record<string, unknown>)['initial-version']).toBe('0.1.0');
  });

  it('el manifiesto coincide con la versión actual del paquete', () => {
    const pkg = JSON.parse(read('proyecto/package.json')) as { version: string };
    expect(manifest['proyecto']).toBe(pkg.version);
  });

  it('el workflow fija la acción por SHA y no publica con permisos de más', () => {
    const workflow = read('.github/workflows/release-please.yml');
    expect(workflow).toMatch(/googleapis\/release-please-action@[0-9a-f]{40} # v/);
    expect(workflow).toMatch(/branches: \[main\]/);
    expect(workflow).not.toMatch(/pull_request_target|NPM_TOKEN|npm publish/);
    expect(workflow).toMatch(/cancel-in-progress: false/);
  });
});
