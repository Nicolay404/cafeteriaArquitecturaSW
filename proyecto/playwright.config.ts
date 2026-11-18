import { defineConfig, devices } from '@playwright/test';

// E2E local (contracts/platform.md): arranca web/API/worker con `pnpm dev` contra la
// infraestructura Compose ya levantada y espera a que el proxy web→API responda 200.
// E2E_ENV_FILE permite usar .env.example u otro archivo explícito, como en infra:check.
const envFile = process.env.E2E_ENV_FILE;
const webOrigin = 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // Sin reintentos: un fallo intermitente debe verse, no ocultarse (plan §2, CI y calidad).
  retries: 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: { baseURL: webOrigin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: envFile ? `pnpm dev --env-file ${envFile}` : 'pnpm dev',
    url: `${webOrigin}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
});
