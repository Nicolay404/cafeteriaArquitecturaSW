import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hashDirectory, migrationChecksums } from '../../scripts/ci/package-candidate.js';

// T041/T042 — la identidad de un paquete depende SOLO de su contenido: mismo contenido, mismo hash,
// sin importar el orden de creación ni cuándo se construyó; cualquier cambio lo altera.
const directories: string[] = [];
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});

function folder(files: Record<string, string>, order: string[] = Object.keys(files)) {
  const path = mkdtempSync(join(tmpdir(), 'cafeteria-hash-'));
  directories.push(path);
  for (const name of order) {
    const full = join(path, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, files[name]!);
  }
  return path;
}

describe('hashDirectory', () => {
  const files = { 'a.txt': 'uno', 'sub/b.txt': 'dos', 'sub/hondo/c.txt': 'tres' };

  it('devuelve un hash sha256 con prefijo', () => {
    expect(hashDirectory(folder(files))).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('el mismo contenido da el mismo hash aunque se cree en otro orden y en otra carpeta', () => {
    const one = hashDirectory(folder(files));
    const two = hashDirectory(folder(files, ['sub/hondo/c.txt', 'sub/b.txt', 'a.txt']));
    expect(two).toBe(one);
  });

  it('cambiar un solo byte cambia el hash', () => {
    expect(hashDirectory(folder({ ...files, 'a.txt': 'unO' }))).not.toBe(
      hashDirectory(folder(files)),
    );
  });

  it('renombrar o mover un archivo cambia el hash aunque el contenido sea el mismo', () => {
    const original = hashDirectory(folder(files));
    expect(
      hashDirectory(folder({ 'z.txt': 'uno', 'sub/b.txt': 'dos', 'sub/hondo/c.txt': 'tres' })),
    ).not.toBe(original);
    expect(
      hashDirectory(folder({ 'a.txt': 'uno', 'b.txt': 'dos', 'sub/hondo/c.txt': 'tres' })),
    ).not.toBe(original);
  });

  it('el contenido de un archivo no se confunde con el nombre de otro', () => {
    const one = hashDirectory(folder({ ab: 'c' }));
    const two = hashDirectory(folder({ a: 'bc' }));
    expect(one).not.toBe(two);
  });

  it('ignora lo excluido, a cualquier profundidad, y nada más', () => {
    const base = hashDirectory(folder(files), { exclude: ['cache'] });
    expect(
      hashDirectory(folder({ ...files, 'cache/x.bin': 'ruido', 'sub/cache/y.bin': 'ruido' }), {
        exclude: ['cache'],
      }),
    ).toBe(base);
    expect(
      hashDirectory(folder({ ...files, 'otro/x.bin': 'ruido' }), { exclude: ['cache'] }),
    ).not.toBe(base);
  });

  it('una carpeta vacía tiene un hash estable y distinto al de una con archivos', () => {
    const empty = hashDirectory(folder({}));
    expect(hashDirectory(folder({}))).toBe(empty);
    expect(empty).not.toBe(hashDirectory(folder(files)));
  });

  it('falla si la carpeta no existe, en lugar de devolver el hash de una carpeta vacía', () => {
    expect(() => hashDirectory(join(tmpdir(), 'no-existe-cafeteria-xyz'))).toThrow();
  });
});

describe('migrationChecksums', () => {
  it('devuelve el sha256 de cada migración por versión, sin el prefijo', () => {
    const path = folder({
      '001_uno.sql': 'SELECT 1;',
      '002_dos.sql': 'SELECT 2;',
    });
    const result = migrationChecksums(path);
    expect(Object.keys(result)).toEqual(['001', '002']);
    expect(result['001']).toMatch(/^[0-9a-f]{64}$/);
    expect(result['001']).not.toBe(result['002']);
  });

  it('coincide con el checksum que registra el runner de migraciones', async () => {
    const { loadMigrations } = await import('../../scripts/db/migrate.js');
    const path = folder({ '001_uno.sql': 'SELECT 1;' });
    expect(migrationChecksums(path)['001']).toBe(loadMigrations(path)[0]!.checksum);
  });
});
