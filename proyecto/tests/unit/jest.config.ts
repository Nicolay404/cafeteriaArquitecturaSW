import { fileURLToPath } from 'node:url';
import type { Config } from 'jest';

// Unitarios de comportamiento de API y worker (Jest, como en research.md). Sin Docker:
// la integración real con Postgres/Redis/RabbitMQ vive en tests/integration.
const config: Config = {
  rootDir: fileURLToPath(new URL('../../', import.meta.url)),
  testEnvironment: 'node',
  testMatch: ['<rootDir>/apps/api/src/**/*.spec.ts', '<rootDir>/apps/worker/src/**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { useESM: true, tsconfig: '<rootDir>/tests/unit/tsconfig.backend.json' },
    ],
  },
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts', '!**/*.spec.ts'],
  coverageDirectory: 'coverage/unit-jest',
  coverageReporters: ['lcov', 'text-summary'],
  testTimeout: 15_000,
  restoreMocks: true,
};

export default config;
