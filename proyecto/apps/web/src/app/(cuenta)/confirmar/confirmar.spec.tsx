// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../../test/api-mock.ts';
import { Confirmar } from './confirmar.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TOKEN = 'B'.repeat(43);

describe('Confirmar', () => {
  it('con token NO confirma al abrir: espera a que se pulse el botón', () => {
    const calls = mockApi({});
    render(<Confirmar token={TOKEN} />);
    expect(calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Confirmar mi correo' })).toBeTruthy();
  });

  it('al pulsar confirma con el token y muestra «Correo confirmado»', async () => {
    const calls = mockApi({ 'confirmar-correo': { status: 204 } });
    render(<Confirmar token={TOKEN} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar mi correo' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Correo confirmado' }),
    ).toBeTruthy();
    expect(calls[0]).toMatchObject({ ruta: 'confirmar-correo', body: { token: TOKEN } });
    expect(screen.getByRole('link', { name: 'Iniciar sesión' }).getAttribute('href')).toBe(
      '/acceso',
    );
  });

  it('un enlace usado o caducado explica qué hacer y ofrece pedir uno nuevo', async () => {
    mockApi({
      'confirmar-correo': {
        status: 410,
        body: { codigo: 'enlace_caducado', mensaje: 'Este enlace caducó. Pide uno nuevo.' },
      },
    });
    render(<Confirmar token={TOKEN} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Confirmar mi correo' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'No pudimos confirmar tu correo' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/Pide uno nuevo/);
    expect(screen.getByRole('button', { name: 'Enviar un enlace nuevo' })).toBeTruthy();
  });

  it('sin token muestra directamente el formulario para pedir un enlace', () => {
    render(<Confirmar token="" />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Pedir un enlace de confirmación' }),
    ).toBeTruthy();
    expect(screen.getByText(/Escribe el correo con el que te registraste/)).toBeTruthy();
  });

  it('reenviar: valida el correo, lo manda normalizado y responde sin confirmar si existe', async () => {
    const calls = mockApi({ 'reenviar-confirmacion': { status: 202 } });
    const user = userEvent.setup();
    render(<Confirmar token="" />);

    await user.click(screen.getByRole('button', { name: 'Enviar un enlace nuevo' }));
    expect(calls).toEqual([]);
    expect(document.getElementById('correo-error')!.textContent).toMatch(/nombre@dominio/);

    await user.type(document.getElementById('correo')!, 'Ana@Ejemplo.com');
    await user.click(screen.getByRole('button', { name: 'Enviar un enlace nuevo' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/Si la cuenta existe/);
    expect(calls[0]).toMatchObject({
      ruta: 'reenviar-confirmacion',
      body: { correo: 'ana@ejemplo.com' },
    });
  });

  it('reenviar: un fallo del servicio se muestra en el campo', async () => {
    mockApi({
      'reenviar-confirmacion': {
        status: 503,
        body: { codigo: 'servicio_no_disponible', mensaje: 'Sin servicio.' },
      },
    });
    const user = userEvent.setup();
    render(<Confirmar token="" />);
    await user.type(document.getElementById('correo')!, 'ana@ejemplo.com');
    await user.click(screen.getByRole('button', { name: 'Enviar un enlace nuevo' }));
    await screen.findByText('Hay 1 error que corregir');
    expect(document.getElementById('correo-error')!.textContent).toMatch(/Sin servicio/);
  });
});
