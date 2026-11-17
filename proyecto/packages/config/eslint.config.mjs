import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.pnpm-store/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/*.min.js',
      '**/next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      // Relative to this config: proyecto/, not the Git root.
      'boundaries/root-path': fileURLToPath(new URL('../../', import.meta.url)),
      'boundaries/elements': [
        { type: 'domain', pattern: 'apps/api/src/modules/*', capture: ['domain'] },
        { type: 'platform', pattern: 'apps/api/src/platform' },
        { type: 'shared', pattern: 'packages/*' },
      ],
      'import/resolver': { typescript: { project: 'tsconfig.json' } },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            { disallow: { to: { element: { type: 'domain' } } } },
            { allow: { to: { element: { type: 'domain', fileInternalPath: 'index.ts' } } } },
            {
              from: { element: { type: 'domain' } },
              disallow: { to: { element: { type: 'platform' } } },
            },
          ],
        },
      ],
    },
  },
];
