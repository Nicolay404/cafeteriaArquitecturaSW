import { defineConfig } from 'vitest/config';

// Unitarios Vitest: configuración/scripts (node) y componentes web (proyecto apps/web).
// API y worker usan Jest (tests/unit/jest.config.ts); el LCOV se fusiona con coverage:merge.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'node', include: ['tests/unit/**/*.spec.ts'] } },
      'apps/web/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'apps/web/src/**/*.{ts,tsx}',
        'packages/*/src/**/*.ts',
        'scripts/**/*.ts',
        'apps/api/src/platform/config.ts',
        'apps/worker/src/config.ts',
      ],
      exclude: ['**/*.spec.ts', '**/*.spec.tsx'],
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: 'coverage/unit-vitest',
    },
  },
});
