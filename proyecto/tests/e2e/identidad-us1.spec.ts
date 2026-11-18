import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createClient } from 'redis';

// T022 — US1 en el navegador real, contra la API, Postgres, Redis y Mailpit locales: registro,
// confirmación, acceso, cierre y recuperación, con teclado y con axe (incluida la regla AAA de
// contraste mejorado, 7:1). axe sin violaciones NO demuestra WCAG AAA: falta la prueba manual con
// lector de pantalla (T023).
const mailpit = `http://127.0.0.1:${process.env['MAILPIT_UI_PORT'] ?? '8025'}`;
const redisUrl = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
const PASSWORD = 'cafe con leche y pan tostado';
const NEW_PASSWORD = 'una frase nueva bastante larga';
const email = () => `e2e${Date.now()}${Math.floor(Math.random() * 1000)}@ejemplo.com`;

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function clearLimits() {
  // Los límites por IP (5 registros por hora) persisten entre ejecuciones: se limpian solo en local.
  const redis = createClient({ url: redisUrl });
  await redis.connect();
  try {
    const keys = await redis.keys('cafeteria:local:limite:*');
    if (keys.length > 0) await redis.del(keys);
  } finally {
    redis.destroy();
  }
}

async function linkFor(to: string, subject: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const list = (await (await fetch(`${mailpit}/api/v1/messages`)).json()) as {
      messages: MailpitMessage[];
    };
    const message = list.messages.find(
      (item) => item.To[0]?.Address === to && item.Subject === subject,
    );
    if (message) {
      const { Text } = (await (await fetch(`${mailpit}/api/v1/message/${message.ID}`)).json()) as {
        Text: string;
      };
      const match = /https?:\/\/[^\s]+/.exec(Text);
      if (match) return new URL(match[0]).pathname + new URL(match[0]).search;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No llegó el correo «${subject}» a ${to}`);
}

async function accessible(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'wcag2aaa', 'best-practice'])
    .exclude('nextjs-portal')
    .analyze();
  expect(results.violations.map((item) => `${name}: ${item.id} (${item.nodes.length})`)).toEqual(
    [],
  );
}

async function register(page: Page, correo: string) {
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: false }).first().fill('Ana Pérez');
  await page.getByLabel('Correo electrónico').fill(correo);
  await page.locator('#contrasena').fill(PASSWORD);
  await page.getByLabel(/Acepto la política/).check();
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa tu correo');
}

async function activate(page: Page, correo: string) {
  await register(page, correo);
  await page.goto(await linkFor(correo, 'Confirma tu correo'));
  await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correo confirmado');
}

async function login(page: Page, correo: string, contrasena: string) {
  await page.goto('/acceso');
  await page.getByLabel('Correo electrónico').fill(correo);
  await page.locator('#contrasena').fill(contrasena);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

test.beforeEach(clearLimits);

test.describe('US1 — pantallas de cuenta', () => {
  test('registro, confirmación, acceso y cierre de sesión de punta a punta', async ({ page }) => {
    const correo = email();
    await activate(page, correo);

    await login(page, correo, PASSWORD);
    await expect(page).toHaveURL(/\/cuenta$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hola, Ana Pérez');

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/acceso$/);
    await page.goto('/cuenta');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tu sesión terminó');
  });

  test('un formulario vacío manda el foco al resumen de errores, que enlaza a cada campo', async ({
    page,
  }) => {
    await page.goto('/registro');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    const summary = page.locator('.resumen-errores');
    await expect(summary).toBeFocused();
    await expect(summary).toContainText('Hay 4 errores que corregir');
    await expect(page.getByLabel('Nombre').first()).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#nombre-error')).toContainText('Escribe tu nombre');
    await expect(page.locator('#contrasena-error')).toContainText('Usa al menos 12 caracteres');

    await summary.getByRole('link', { name: /correo con el formato/ }).click();
    await expect(page.getByLabel('Correo electrónico')).toBeFocused();
  });

  test('se completa solo con teclado: registro y acceso', async ({ page }) => {
    const correo = email();
    await page.goto('/registro');
    await page.getByLabel('Nombre').first().focus();
    await page.keyboard.type('Ana Pérez');
    await page.keyboard.press('Tab');
    await page.keyboard.type(correo);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Tab'); // botón «Mostrar contraseña»
    await page.keyboard.press('Tab'); // casilla
    await page.keyboard.press('Space');
    await expect(page.getByLabel(/Acepto la política/)).toBeChecked();
    await page.keyboard.press('Tab'); // enviar
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa tu correo');

    await page.goto(await linkFor(correo, 'Confirma tu correo'));
    await page.getByRole('button', { name: 'Confirmar mi correo' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Correo confirmado');

    await page.goto('/acceso');
    await page.getByLabel('Correo electrónico').focus();
    await page.keyboard.type(correo);
    await page.keyboard.press('Tab');
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/cuenta$/);
  });

  test('los errores de acceso no revelan si la cuenta existe y no hay acceso sin confirmar', async ({
    page,
  }) => {
    const correo = email();
    await register(page, correo);
    await login(page, correo, PASSWORD);
    await expect(page.locator('.estado-error')).toContainText('Aún no confirmaste tu correo');
    await expect(page.getByRole('link', { name: /nuevo enlace de confirmación/ })).toBeVisible();

    await login(page, 'nadie@ejemplo.com', 'una contraseña cualquiera');
    const unknown = await page.locator('.estado-error').innerText();
    await activate(page, email());
    await login(page, correo, 'otra contraseña distinta');
    // Mismo texto exacto para cuenta inexistente y para contraseña incorrecta.
    await login(page, 'nadie2@ejemplo.com', 'otra contraseña distinta');
    expect(await page.locator('.estado-error').innerText()).toBe(unknown);
  });

  test('recuperar la contraseña: enlace de un solo uso y contraseña débil sin gastarlo', async ({
    page,
  }) => {
    const correo = email();
    await activate(page, correo);

    await page.goto('/recuperar');
    await page.getByLabel('Correo electrónico').fill(correo);
    await page.getByRole('button', { name: 'Enviar el enlace' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Revisa tu correo');

    const link = await linkFor(correo, 'Recupera tu contraseña');
    await page.goto(link);
    await page.locator('#contrasena').fill('Password1234');
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.locator('#contrasena-error')).toContainText('demasiado común');

    await page.locator('#contrasena').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Contraseña cambiada');

    // El enlace ya se gastó: la página no lo sabe hasta que se intenta usar.
    await page.goto(link);
    await page.locator('#contrasena').fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Guardar contraseña' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Este enlace no sirve');
    await expect(page.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeVisible();

    await login(page, correo, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/cuenta$/);
  });

  test('un enlace de confirmación inventado explica qué hacer', async ({ page }) => {
    await page.goto(`/confirmar?token=${'A'.repeat(43)}`);
    await page.getByRole('button', { name: 'Confirmar mi correo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'No pudimos confirmar tu correo',
    );
    await expect(page.locator('.estado-error')).toContainText('Pide uno nuevo');
    await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  });

  test('contraste, etiquetas y estructura pasan axe (incluido el contraste AAA de 7:1)', async ({
    page,
  }) => {
    for (const ruta of ['/registro', '/acceso', '/recuperar', '/confirmar']) {
      await page.goto(ruta);
      await accessible(page, ruta);
    }
    // Con errores visibles también.
    await page.goto('/registro');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await accessible(page, '/registro con errores');
  });

  test('los objetivos táctiles miden al menos 44 px y el foco se ve', async ({ page }) => {
    await page.goto('/registro');
    const targets = page.locator('main input:not([type=checkbox]), main button');
    for (const target of await targets.all()) {
      const box = await target.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const checkbox = page.getByLabel(/Acepto la política/);
    await checkbox.focus();
    await expect(checkbox).toHaveCSS('outline-style', 'solid');
    await expect(checkbox).not.toHaveCSS('outline-width', '0px');
  });

  test('la casilla de la política no aplasta su etiqueta (en escritorio y en 320 px)', async ({
    page,
  }) => {
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/registro');
      const box = await page.getByLabel(/Acepto la política/).boundingBox();
      const label = await page.locator('label[for="aceptaPolitica"]').boundingBox();
      expect(box?.width ?? 0).toBeLessThanOrEqual(36);
      expect(label?.width ?? 0).toBeGreaterThan(width === 320 ? 180 : 300);
      // Un texto de tres líneas, no de decenas: la etiqueta no se parte letra por letra.
      expect(label?.height ?? 0).toBeLessThan(width === 320 ? 220 : 130);
      const overflow = (await page.evaluate(
        'document.documentElement.scrollWidth - document.documentElement.clientWidth',
      )) as number;
      expect(overflow).toBeLessThanOrEqual(0);
    }
  });

  test('con movimiento reducido todo queda quieto y visible', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/acceso');
    const button = page.getByRole('button', { name: 'Iniciar sesión' });
    await button.hover();
    await expect(button).toHaveCSS('transform', 'none');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
