import { defineConfig } from '@playwright/test';

// Smoke contra un entorno ya desplegado o arrancado: nunca levanta servidores y exige
// URLs explícitas (contracts/platform.md). Falta o formato inválido falla por nombre.
function explicitUrl(name: 'SMOKE_WEB_URL' | 'SMOKE_API_URL'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}: el smoke requiere una URL explícita`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} no es una URL válida`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${name} debe usar http o https`);
  }
  if (url.username || url.password) throw new Error(`${name} no debe incluir credenciales`);
  return url.origin;
}

const web = explicitUrl('SMOKE_WEB_URL');
// Las pruebas leen la API desde aquí; queda validada antes de ejecutar ninguna.
process.env.SMOKE_API_ORIGIN = explicitUrl('SMOKE_API_URL');

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: '../../test-results/smoke',
  use: { baseURL: web },
});
