// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mockLocation } from '../../../test/api-mock.ts';
import { FormularioAcceso } from './formulario.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function fill(correo = 'ana@ejemplo.com', contrasena = 'una contraseña cualquiera') {
  const user = userEvent.setup();
  render(<FormularioAcceso />);
  if (correo) await user.type(screen.getByLabelText(/Correo electrónico/), correo);
  if (contrasena) await user.type(document.getElementById('contrasena')!, contrasena);
  await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
  return user;
}

describe('FormularioAcceso', () => {
  it('con el formulario vacío no llama a la API y muestra los dos errores', async () => {
    const calls = mockApi({});
    await fill('', '');
    expect(calls).toEqual([]);
    expect(screen.getByText('Hay 2 errores que corregir')).toBeTruthy();
    expect(document.getElementById('correo')!.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('contrasena-error')!.textContent).toMatch(
      /Escribe tu contraseña/,
    );
  });

  it('con credenciales correctas envía el correo normalizado y navega a /cuenta', async () => {
    const calls = mockApi({ acceso: { body: { requiereMfa: false, rol: 'cliente' } } });
    const assign = mockLocation();
    await fill('  ANA@Ejemplo.com ');
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/cuenta'));
    expect(calls[0]).toMatchObject({
      ruta: 'acceso',
      body: { correo: 'ana@ejemplo.com', contrasena: 'una contraseña cualquiera' },
    });
  });

  it('si la cuenta exige segundo factor lo dice y no navega', async () => {
    mockApi({ acceso: { body: { requiereMfa: true, rol: 'personal' } } });
    const assign = mockLocation();
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/segundo factor/);
    expect(assign).not.toHaveBeenCalled();
  });

  it('un correo sin confirmar explica qué hacer y ofrece pedir otro enlace', async () => {
    mockApi({
      acceso: {
        status: 403,
        body: { codigo: 'correo_sin_confirmar', mensaje: 'Aún no confirmaste tu correo.' },
      },
    });
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Aún no confirmaste/);
    expect(
      screen.getByRole('link', { name: /nuevo enlace de confirmación/ }).getAttribute('href'),
    ).toBe('/confirmar');
  });

  it('credenciales incorrectas muestran el mensaje de la API', async () => {
    mockApi({
      acceso: {
        status: 401,
        body: {
          codigo: 'credenciales_invalidas',
          mensaje: 'El correo o la contraseña no son correctos.',
        },
      },
    });
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/no son correctos/);
  });

  it('un bloqueo dice cuánto esperar y que se avisó por correo', async () => {
    mockApi({
      acceso: {
        status: 429,
        headers: { 'retry-after': '900' },
        body: { codigo: 'demasiados_intentos', mensaje: 'x' },
      },
    });
    await fill();
    const text = (await screen.findByRole('alert')).textContent ?? '';
    expect(text).toMatch(/espera 15 minutos/);
    expect(text).toMatch(/avisamos por correo/);
  });

  it('errores por campo de la API se pintan en su campo', async () => {
    mockApi({
      acceso: {
        status: 400,
        body: {
          codigo: 'datos_invalidos',
          mensaje: 'Revisa',
          campos: [{ campo: 'correo', mensaje: 'Escribe un correo válido.' }],
        },
      },
    });
    await fill();
    await waitFor(() =>
      expect(document.getElementById('correo-error')!.textContent).toMatch(/correo válido/),
    );
  });

  it('si no hay red muestra un aviso con qué hacer', async () => {
    mockApi({ acceso: { fail: true } });
    await fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Revisa tu conexión/);
  });

  it('el botón de la contraseña la muestra y la oculta', async () => {
    mockApi({});
    const user = userEvent.setup();
    render(<FormularioAcceso />);
    const input = document.getElementById('contrasena') as HTMLInputElement;
    expect(input.type).toBe('password');
    await user.click(screen.getByRole('button', { name: /Mostrar/ }));
    expect(input.type).toBe('text');
    await user.click(screen.getByRole('button', { name: /Ocultar/ }));
    expect(input.type).toBe('password');
  });

  it('tiene enlaces a recuperar contraseña y a crear cuenta', () => {
    render(<FormularioAcceso />);
    expect(screen.getByRole('link', { name: 'Olvidé mi contraseña' }).getAttribute('href')).toBe(
      '/recuperar',
    );
    expect(screen.getByRole('link', { name: 'Crea una' }).getAttribute('href')).toBe('/registro');
  });
});
