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
  maxWorkers: 1,
  testTimeout: 180_000,
  clearMocks: true,
};

export default config;
