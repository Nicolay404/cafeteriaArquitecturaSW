import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';

// Comprobaciones del hook pre-commit sobre los archivos en el índice. Usa los binarios de
// proyecto/node_modules con Node directamente y trabaja desde proyecto/, donde viven las
// configuraciones de Prettier y ESLint.
const root = resolve(import.meta.dirname, '..', '..');
const app = resolve(root, 'proyecto');
const files = process.argv.slice(2).map((file) => resolve(file));
const lintable = /\.(ts|tsx|mjs|cjs|js)$/;

function tool(name, bin, args) {
  const result = spawnSync(process.execPath, [resolve(app, 'node_modules', bin), ...args], {
    cwd: app,
    stdio: 'inherit',
  });
  if (result.status !== 0)
    console.error(`\npre-commit: falló ${name}; corrige y vuelve a intentarlo.`);
  return result.status === 0;
}

const relativeFiles = files.map((file) => relative(app, file));
const inside = files
  .filter((file) => file.startsWith(app + sep))
  .map((file) => relative(app, file));
const results = [
  tool('Prettier', 'prettier/bin/prettier.cjs', [
    '--check',
    '--config',
    '.prettierrc.json',
    ...relativeFiles,
  ]),
];
const toLint = inside.filter((file) => lintable.test(file));
if (toLint.length > 0)
  results.push(tool('ESLint', 'eslint/bin/eslint.js', ['--no-warn-ignored', ...toLint]));
process.exitCode = results.every(Boolean) ? 0 : 1;
