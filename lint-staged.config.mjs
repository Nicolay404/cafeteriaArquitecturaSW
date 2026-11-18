// Se ejecuta desde la raíz Git (hook pre-commit). Las rutas llegan absolutas y entre comillas.
const staged = (files) =>
  `node scripts/ci/staged-checks.mjs ${files.map((file) => `"${file}"`).join(' ')}`;

export default {
  'proyecto/**/*.{ts,tsx,mjs,cjs,js,json,yaml}': staged,
  'scripts/ci/**/*.{ts,mjs,json}': staged,
};
