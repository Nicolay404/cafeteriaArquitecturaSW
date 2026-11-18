import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// T018 — inicio básico (T013) y su conexión con la API a través del proxy (T014).
// No exige diseño final ni material aprobado; axe sin violaciones NO demuestra WCAG AAA
// (faltan lector de pantalla, ampliación de texto y revisión humana: T040/T083).
const apiOrigin = 'http://127.0.0.1:3001';

test.describe('inicio básico', () => {
  test('tiene idioma, título, un h1 y landmark principal con texto veraz', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page).toHaveTitle('Cafetería');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cafetería');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText('todavía no están disponibles')).toBeVisible();
  });

  test('no ofrece controles ni recursos hacia flujos que todavía no existen', async ({ page }) => {
    await page.goto('/');
    // Solo el contenido de la página: el overlay de desarrollo de Next vive en un shadow DOM propio.
    const flows = 'form, button, input, select, textarea, img, video';
    await expect(page.locator(`main :is(${flows})`)).toHaveCount(0);
    await expect(page.locator(`body > :is(${flows})`)).toHaveCount(0);
    await expect(page.locator('main a')).toHaveCount(0);
    await expect(page.locator('body > a')).toHaveCount(1);
  });

  test('el primer Tab muestra el enlace de salto y Enter lleva el foco al contenido', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport({ ratio: 1 });
    const box = await skip.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(skip).toHaveCSS('outline-style', 'solid');
    await expect(skip).not.toHaveCSS('outline-width', '0px');

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#contenido$/);
    await expect(page.locator('#contenido')).toBeFocused();
  });

  test('el contenido sigue visible con movimiento reducido', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('axe no encuentra violaciones (WCAG A/AA 2.2, mejores prácticas y AAA automatizable)', async ({
    page,
  }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags([
        'wcag2a',
        'wcag2aa',
        'wcag21a',
        'wcag21aa',
        'wcag22aa',
        'wcag2aaa',
        'best-practice',
      ])
      .analyze();
    // Garantiza que axe evaluó reglas de verdad y no devolvió un informe vacío.
    expect(results.passes.length).toBeGreaterThan(10);
    expect(results.violations.map((item) => ({ id: item.id, nodes: item.nodes.length }))).toEqual(
      [],
    );
  });

  test('reflow en 320 px sin desplazamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    const overflow = (await page.evaluate(
      'document.documentElement.scrollWidth - document.documentElement.clientWidth',
    )) as number;
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('conexión web → API', () => {
  test('el proxy web devuelve la misma versión y estado que la API, sin caché', async ({
    request,
  }) => {
    const viaWeb = await request.get('/api/health');
    const direct = await request.get(`${apiOrigin}/health`);
    expect(direct.status()).toBe(200);
    expect(viaWeb.status()).toBe(200);
    expect(viaWeb.headers()['cache-control']).toContain('no-store');
    const body = await viaWeb.json();
    expect(body).toEqual(await direct.json());
    expect(body).toEqual({ status: 'ok', version: expect.any(String) });
  });

  test('la API sigue viva (liveness) y la web no expone detalles de infraestructura', async ({
    request,
  }) => {
    const live = await request.get(`${apiOrigin}/health/live`);
    expect(live.status()).toBe(200);
    const text = await (await request.get('/api/health')).text();
    expect(text).not.toMatch(/postgres|redis|rabbit|password|solo_pruebas|amqp:|@127\.0\.0\.1/i);
  });
});
