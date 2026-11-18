// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../../test/api-mock.ts';
import { FormularioRestablecer } from './formulario.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TOKEN = 'A'.repeat(43);

async function submit(password: string, token = TOKEN) {
  const user = userEvent.setup();
  render(<FormularioRestablecer token={token} />);
  if (password) await user.type(document.getElementById('contrasena')!, password);
  await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
}

describe('FormularioRestablecer', () => {
  it('sin token explica que el enlace no sirve y ofrece pedir otro', () => {
    render(<FormularioRestablecer token="" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Este enlace no sirve' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' }).getAttribute('href')).toBe(
      '/recuperar',
    );
  });

  it('una contraseña corta se rechaza en el navegador sin gastar el enlace', async () => {
    const calls = mockApi({});
    await submit('corta');
    expect(calls).toEqual([]);
    expect(document.getElementById('contrasena-error')!.textContent).toMatch(/al menos 12/);
  });

  it('un token mal formado pasa a «Este enlace no sirve»', async () => {
    const calls = mockApi({});
    await submit('una frase nueva bastante larga', 'corto');
    expect(calls).toEqual([]);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace no sirve' }),
    ).toBeTruthy();
  });

  it('éxito: manda el token y la contraseña y confirma que se cerraron las demás sesiones', async () => {
    const calls = mockApi({ restablecer: { status: 204 } });
    await submit('una frase nueva bastante larga');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Contraseña cambiada' }),
    ).toBeTruthy();
    expect(calls[0]).toMatchObject({
      ruta: 'restablecer',
      body: { token: TOKEN, contrasena: 'una frase nueva bastante larga' },
    });
    expect(screen.getByRole('status').textContent).toMatch(/otras sesiones/);
  });

  it('un enlace usado o caducado (410) pasa a «Este enlace no sirve»', async () => {
    mockApi({
      restablecer: {
        status: 410,
        body: { codigo: 'enlace_usado', mensaje: 'Este enlace ya se usó.' },
      },
    });
    await submit('una frase nueva bastante larga');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace no sirve' }),
    ).toBeTruthy();
  });

  it('una contraseña común (400 de la API) se pinta en el campo y se puede corregir', async () => {
    mockApi({
      restablecer: {
        status: 400,
        body: {
          codigo: 'datos_invalidos',
          mensaje: 'Revisa',
          campos: [{ campo: 'contrasena', mensaje: 'Esa contraseña es demasiado común.' }],
        },
      },
    });
    await submit('una frase nueva bastante larga');
    await waitFor(() =>
      expect(document.getElementById('contrasena-error')!.textContent).toMatch(/demasiado común/),
    );
    expect(screen.getByRole('button', { name: 'Guardar contraseña' })).toBeTruthy();
  });

  it('un fallo general muestra su mensaje', async () => {
    mockApi({
      restablecer: {
        status: 503,
        body: { codigo: 'servicio_no_disponible', mensaje: 'Sin servicio.' },
      },
    });
    await submit('una frase nueva bastante larga');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sin servicio/);
  });
});
