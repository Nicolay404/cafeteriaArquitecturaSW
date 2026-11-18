import { expect, test } from '@playwright/test';

// T018 — smoke contra un entorno ya arrancado o desplegado. Las URLs vienen de
// SMOKE_WEB_URL y SMOKE_API_URL (validadas en playwright.config.ts); nunca arranca nada.
const apiOrigin = () => {
  const value = process.env.SMOKE_API_ORIGIN;
  if (!value)
    throw new Error('SMOKE_API_ORIGIN no está definido: usa tests/smoke/playwright.config.ts');
  return value;
};

test('la página inicial responde con su contenido básico', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Cafetería' })).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
});

test('el proxy web refleja una API sana, con versión y sin caché', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  expect(await response.json()).toEqual({ status: 'ok', version: expect.any(String) });
});

test('la API responde liveness y readiness con la misma versión que ve la web', async ({
  request,
}) => {
  const live = await request.get(`${apiOrigin()}/health/live`);
  expect(live.status()).toBe(200);
  const ready = await request.get(`${apiOrigin()}/health`);
  expect(ready.status()).toBe(200);
  const viaWeb = await request.get('/api/health');
  expect(await viaWeb.json()).toEqual(await ready.json());
});
