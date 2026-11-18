import { fileURLToPath } from 'node:url';
import type { Config } from 'jest';

const config: Config = {
  rootDir: fileURLToPath(new URL('../../', import.meta.url)),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/integration/**/*.int.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { useESM: true, tsconfig: '<rootDir>/tests/integration/tsconfig.json' },
    ],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Solo cuenta el código cargado en este proceso; los procesos hijos (API/worker/web
  // arrancados por las pruebas) no se instrumentan y no inflan la cobertura. Los
  // componentes .tsx los mide Vitest; este runner no compila JSX.
  collectCoverageFrom: [
    'apps/*/src/**/*.ts',
    'packages/*/src/**/*.ts',
    'scripts/**/*.ts',
    '!**/*.spec.ts',
  ],
  coverageDirectory: 'coverage/integration',
  coverageReporters: ['lcov', 'text-summary'],
  maxWorkers: 1,
  testTimeout: 180_000,
  clearMocks: true,
};

export default config;
