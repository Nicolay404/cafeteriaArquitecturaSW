import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Fusiona los LCOV de cada runner (Vitest, Jest unitario, Jest de integración) en un solo
// informe con rutas relativas a proyecto/, un registro por archivo y sin código generado,
// para que Sonar no cuente dos veces el mismo archivo ni analice dependencias o builds.

interface FileCoverage {
  lines: Map<number, number>;
  functions: Map<string, { line: number; hits: number }>;
  branches: Map<string, number>;
}

const excluded = [
  /(^|\/)node_modules\//,
  /(^|\/)\.next\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)tests\//,
  /\.(spec|test|int\.spec)\.[cm]?[jt]sx?$/,
  /\.d\.ts$/,
];

function normalize(file: string, root: string): string | undefined {
  const posixRoot = root.replaceAll('\\', '/');
  const posixFile = file.trim().replaceAll('\\', '/');
  const absoluteWindows = /^[A-Za-z]:\//.test(posixFile);
  const path =
    absoluteWindows || isAbsolute(posixFile)
      ? relative(posixRoot, posixFile).replaceAll('\\', '/')
      : posixFile.replace(/^\.\//, '');
  if (!path || path.startsWith('../') || /^[A-Za-z]:\//.test(path)) return undefined;
  return excluded.some((pattern) => pattern.test(path)) ? undefined : path;
}

const add = (map: Map<string | number, number>, key: string | number, hits: number) =>
  map.set(key, (map.get(key) ?? 0) + hits);

export function mergeLcov(reports: string[], root: string): string {
  const files = new Map<string, FileCoverage>();
  for (const report of reports) {
    let current: FileCoverage | undefined;
    for (const raw of report.split(/\r?\n/)) {
      const line = raw.trim();
      const separator = line.indexOf(':');
      const tag = separator === -1 ? line : line.slice(0, separator);
      const value = line.slice(separator + 1);
      if (tag === 'SF') {
        const path = normalize(value, root);
        if (path === undefined) {
          current = undefined;
          continue;
        }
        current = files.get(path) ?? {
          lines: new Map(),
          functions: new Map(),
          branches: new Map(),
        };
        files.set(path, current);
      } else if (tag === 'end_of_record') {
        current = undefined;
      } else if (current && tag === 'DA') {
        const [lineNumber, hits] = value.split(',');
        add(current.lines, Number(lineNumber), Number(hits));
      } else if (current && tag === 'FN') {
        const comma = value.indexOf(',');
        const name = value.slice(comma + 1);
        const known = current.functions.get(name);
        current.functions.set(name, {
          line: Number(value.slice(0, comma)),
          hits: known?.hits ?? 0,
        });
      } else if (current && tag === 'FNDA') {
        const comma = value.indexOf(',');
        const name = value.slice(comma + 1);
        const known = current.functions.get(name) ?? { line: 0, hits: 0 };
        known.hits += Number(value.slice(0, comma));
        current.functions.set(name, known);
      } else if (current && tag === 'BRDA') {
        const parts = value.split(',');
        const taken = parts[3] === '-' ? 0 : Number(parts[3]);
        add(current.branches, parts.slice(0, 3).join(','), taken);
      }
    }
  }

  const output: string[] = [];
  for (const path of [...files.keys()].sort()) {
    const coverage = files.get(path)!;
    output.push('TN:', `SF:${path}`);
    const functions = [...coverage.functions].sort((a, b) => a[1].line - b[1].line);
    for (const [name, fn] of functions) output.push(`FN:${fn.line},${name}`);
    for (const [name, fn] of functions) output.push(`FNDA:${fn.hits},${name}`);
    output.push(
      `FNF:${functions.length}`,
      `FNH:${functions.filter(([, fn]) => fn.hits > 0).length}`,
    );
    const branches = [...coverage.branches].sort(([a], [b]) =>
      a.localeCompare(b, 'en', { numeric: true }),
    );
    for (const [key, hits] of branches) output.push(`BRDA:${key},${hits}`);
    output.push(`BRF:${branches.length}`, `BRH:${branches.filter(([, hits]) => hits > 0).length}`);
    const lines = [...coverage.lines].sort(([a], [b]) => a - b);
    for (const [lineNumber, hits] of lines) output.push(`DA:${lineNumber},${hits}`);
    output.push(
      `LF:${lines.length}`,
      `LH:${lines.filter(([, hits]) => hits > 0).length}`,
      'end_of_record',
    );
  }
  if (output.length === 0) throw new Error('Sin cobertura de código fuente que informar');
  return `${output.join('\n')}\n`;
}

const sources = ['coverage/unit-vitest', 'coverage/unit-jest', 'coverage/integration'];

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const reports = sources
    .map((directory) => resolve(root, directory, 'lcov.info'))
    .filter((file) => existsSync(file));
  try {
    if (reports.length === 0)
      throw new Error('Sin informes LCOV; ejecuta test:unit o test:integration');
    const merged = mergeLcov(
      reports.map((file) => readFileSync(file, 'utf8')),
      root,
    );
    const target = resolve(root, 'coverage/lcov.info');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, merged);
    const count = merged.match(/^SF:/gm)?.length ?? 0;
    console.log(`LCOV fusionado: ${count} archivos desde ${reports.length} informes`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'No se pudo fusionar la cobertura');
    process.exitCode = 1;
  }
}
