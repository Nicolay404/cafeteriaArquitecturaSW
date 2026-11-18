import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadMigrations } from '../db/migrate.js';

// Identidad por CONTENIDO (FR-012): lo que se prueba en un entorno es exactamente lo que se
// promueve al siguiente. Estas utilidades calculan los hashes que entran en el manifiesto del
// candidato; el ensamblado completo (imágenes y manifiesto) llega con T042.

/**
 * Carpetas que Next escribe DENTRO de `.next` al servir la web y que no forman parte del paquete:
 * caché de imágenes/datos (`cache`) y la caché de rutas prerenderizadas (`route-cache`), que se
 * genera la primera vez que se sirve cada página. Se excluyen a propósito y por nombre exacto.
 */
export const WEB_RUNTIME_CACHE = ['cache', 'route-cache'];

/**
 * Hash sha256 del contenido de una carpeta: depende de las rutas relativas y de los bytes de cada
 * archivo, no del orden de creación ni de fechas. `exclude` omite carpetas o archivos por NOMBRE a
 * cualquier profundidad (por ejemplo la caché de compilación). Falla si la carpeta no existe.
 */
export function hashDirectory(directory: string, options: { exclude?: string[] } = {}): string {
  const exclude = new Set(options.exclude ?? []);
  const lines: string[] = [];

  const walk = (current: string, prefix: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (exclude.has(entry.name)) continue;
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full, relative);
      else if (entry.isFile()) {
        const content = createHash('sha256').update(readFileSync(full)).digest('hex');
        // Longitud de la ruta delante: «a»+«bc» no se confunde con «ab»+«c».
        lines.push(`${relative.length}:${relative}\u0000${content}`);
      }
    }
  };
  walk(directory, '');

  lines.sort((a, b) => a.localeCompare(b, 'en'));
  return `sha256:${createHash('sha256').update(lines.join('\n')).digest('hex')}`;
}

/** Checksum sha256 (hexadecimal) de cada migración, por versión: el mismo que registra el runner. */
export function migrationChecksums(directory: string): Record<string, string> {
  return Object.fromEntries(
    loadMigrations(directory).map((migration) => [migration.version, migration.checksum]),
  );
}
