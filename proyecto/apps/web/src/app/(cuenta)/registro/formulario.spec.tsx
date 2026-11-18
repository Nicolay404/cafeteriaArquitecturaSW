// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../../test/api-mock.ts';
import { FormularioRegistro } from './formulario.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(options: { accept?: boolean; password?: string } = {}) {
  const user = userEvent.setup();
  render(<FormularioRegistro />);
  await user.type(document.getElementById('nombre')!, '  Ana Pérez ');
  await user.type(document.getElementById('correo')!, 'ANA@Ejemplo.com');
  await user.type(
    document.getElementById('contrasena')!,
    options.password ?? 'cafe con leche y pan',
  );
  if (options.accept !== false) await user.click(screen.getByLabelText(/Acepto la política/));
  await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
}

describe('FormularioRegistro', () => {
  it('vacío: no llama a la API y el resumen cuenta los cuatro errores', async () => {
    const calls = mockApi({});
    const user = userEvent.setup();
    render(<FormularioRegistro />);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(calls).toEqual([]);
    expect(screen.getByText('Hay 4 errores que corregir')).toBeTruthy();
    expect(document.getElementById('aceptaPolitica-error')!.textContent).toMatch(
      /política de privacidad/,
    );
    expect(document.activeElement?.className).toBe('resumen-errores');
  });

  it('tras un error, escribir para corregirlo NO devuelve el foco al resumen', async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<FormularioRegistro />);
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(document.activeElement?.className).toBe('resumen-errores');
    const name = document.getElementById('nombre') as HTMLInputElement;
    await user.click(name);
    await user.keyboard('Ana Pérez');
    expect(name.value).toBe('Ana Pérez');
    expect(document.activeElement).toBe(name);
  });

  it('con datos válidos manda el correo normalizado y muestra «Revisa tu correo»', async () => {
    const calls = mockApi({ registro: { status: 202, body: {} } });
    await fill();
    expect(await screen.findByRole('heading', { level: 1, name: 'Revisa tu correo' })).toBeTruthy();
    expect(calls[0]).toMatchObject({
      ruta: 'registro',
      body: {
        nombre: 'Ana Pérez',
        correo: 'ana@ejemplo.com',
        contrasena: 'cafe con leche y pan',
        aceptaPolitica: true,
      },
    });
    expect(screen.getByText('ana@ejemplo.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'pide otro enlace' }).getAttribute('href')).toBe(
      '/confirmar',
    );
  });

  it('sin aceptar la política no envía nada', async () => {
    const calls = mockApi({});
    await fill({ accept: false });
    expect(calls).toEqual([]);
    expect(screen.getByText('Hay 1 error que corregir')).toBeTruthy();
  });

  it('una contraseña corta se rechaza en el navegador con el mensaje de la política', async () => {
    const calls = mockApi({});
    await fill({ password: 'corta' });
    expect(calls).toEqual([]);
    expect(document.getElementById('contrasena-error')!.textContent).toMatch(/al menos 12/);
  });

  it('los errores por campo que devuelve la API (p. ej. contraseña común) se pintan', async () => {
    mockApi({
      registro: {
        status: 400,
        body: {
          codigo: 'datos_invalidos',
          mensaje: 'Revisa',
          campos: [{ campo: 'contrasena', mensaje: 'Esa contraseña es demasiado común.' }],
        },
      },
    });
    await fill();
    await waitFor(() =>
      expect(document.getElementById('contrasena-error')!.textContent).toMatch(/demasiado común/),
    );
    expect(screen.getByText('Hay 1 error que corregir')).toBeTruthy();
  });

  it('un límite de registros dice cuánto esperar', async () => {
    mockApi({
      registro: {
        status: 429,
        headers: { 'retry-after': '3000' },
        body: { codigo: 'demasiados_intentos', mensaje: 'x' },
      },
    });
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Espera 50 minutos/);
  });

  it('un fallo general muestra el mensaje del servicio', async () => {
    mockApi({
      registro: {
        status: 503,
        body: { codigo: 'servicio_no_disponible', mensaje: 'Inténtalo luego.' },
      },
    });
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Inténtalo luego/);
  });

  it('enlaza con el inicio de sesión', () => {
    render(<FormularioRegistro />);
    expect(screen.getByRole('link', { name: 'Inicia sesión' }).getAttribute('href')).toBe(
      '/acceso',
    );
  });
});
