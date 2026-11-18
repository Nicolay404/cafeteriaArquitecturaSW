// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mockLocation } from '../../../test/api-mock.ts';
import { Panel } from './panel.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Panel de la cuenta', () => {
  it('mientras carga anuncia que está cargando', () => {
    mockApi({ sesion: { body: { rol: 'cliente', nombre: 'Ana', csrf: 'c' } } });
    render(<Panel />);
    expect(screen.getByRole('status').textContent).toMatch(/Cargando/);
  });

  it('con sesión saluda por el nombre', async () => {
    mockApi({ sesion: { body: { rol: 'cliente', nombre: 'Ana Pérez', csrf: 'c' } } });
    render(<Panel />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Hola, Ana Pérez' })).toBeTruthy();
  });

  it('sin nombre usa un título neutro', async () => {
    mockApi({ sesion: { body: { rol: 'cliente', nombre: null, csrf: 'c' } } });
    render(<Panel />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeTruthy();
  });

  it('cerrar sesión manda el token CSRF y vuelve a /acceso', async () => {
    const calls = mockApi({
      sesion: { body: { rol: 'cliente', nombre: 'Ana', csrf: 'token-csrf' } },
      cierre: { status: 204 },
    });
    const assign = mockLocation();
    render(<Panel />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/acceso'));
    const logout = calls.find((call) => call.ruta === 'cierre');
    expect(logout?.headers['x-csrf-token']).toBe('token-csrf');
  });

  it('sin sesión (401) dice que terminó y ofrece iniciar sesión', async () => {
    mockApi({
      sesion: { status: 401, body: { codigo: 'no_autenticado', mensaje: 'Inicia sesión.' } },
    });
    render(<Panel />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu sesión terminó' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe(
      '/acceso',
    );
  });

  it('otro fallo (503) pide recargar sin mandar a iniciar sesión', async () => {
    mockApi({
      sesion: { status: 503, body: { codigo: 'servicio_no_disponible', mensaje: 'x' } },
    });
    render(<Panel />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Recarga la página/);
    expect(screen.queryByRole('link', { name: 'Iniciar sesión' })).toBeNull();
  });
});
