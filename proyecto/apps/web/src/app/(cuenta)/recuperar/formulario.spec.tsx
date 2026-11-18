// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '../../../test/api-mock.ts';
import { FormularioRecuperar } from './formulario.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function submit(correo: string) {
  const user = userEvent.setup();
  render(<FormularioRecuperar />);
  if (correo) await user.type(document.getElementById('correo')!, correo);
  await user.click(screen.getByRole('button', { name: 'Enviar el enlace' }));
}

describe('FormularioRecuperar', () => {
  it('un correo mal escrito no se envía y dice cómo corregirlo', async () => {
    const calls = mockApi({});
    await submit('sin-arroba');
    expect(calls).toEqual([]);
    expect(document.getElementById('correo-error')!.textContent).toMatch(/nombre@dominio/);
  });

  it('un correo vacío tampoco', async () => {
    const calls = mockApi({});
    await submit('');
    expect(calls).toEqual([]);
    expect(screen.getByText('Hay 1 error que corregir')).toBeTruthy();
  });

  it('éxito: mensaje neutro que no confirma si la cuenta existe', async () => {
    const calls = mockApi({ recuperar: { status: 202 } });
    await submit('Ana@Ejemplo.com');
    expect(await screen.findByRole('heading', { level: 1, name: 'Revisa tu correo' })).toBeTruthy();
    expect(calls[0]).toMatchObject({ ruta: 'recuperar', body: { correo: 'ana@ejemplo.com' } });
    expect(screen.getByRole('status').textContent).toMatch(/Si hay una cuenta con ese correo/);
    expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toBeTruthy();
  });

  it('un fallo del servicio muestra su mensaje y deja reintentar', async () => {
    mockApi({
      recuperar: {
        status: 503,
        body: { codigo: 'servicio_no_disponible', mensaje: 'Sin servicio.' },
      },
    });
    await submit('ana@ejemplo.com');
    expect((await screen.findByRole('alert')).textContent).toMatch(/Sin servicio/);
    expect(screen.getByRole('button', { name: 'Enviar el enlace' })).toBeTruthy();
  });
});
