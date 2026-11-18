import { afterEach, describe, expect, it, vi } from 'vitest';
import { registroRequest } from '@cafeteria/contracts/cuenta';
import { mockApi } from '../../test/api-mock.ts';
import { camposPorNombre, esperaLegible, llamar, validar } from './cliente-api.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('llamar', () => {
  it('envía JSON y el token CSRF y devuelve los datos si la API acepta', async () => {
    const calls = mockApi({ cierre: { status: 200, body: { ok: true } } });
    const result = await llamar<{ ok: boolean }>('cierre', { body: { a: 1 }, csrf: 'tok' });
    expect(result).toEqual({ ok: true, status: 200, data: { ok: true } });
    expect(calls[0]).toMatchObject({
      ruta: 'cierre',
      method: 'POST',
      body: { a: 1 },
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'tok' },
    });
  });

  it('una respuesta vacía (204) es un éxito sin datos', async () => {
    mockApi({ cierre: { status: 204 } });
    expect(await llamar('cierre')).toEqual({ ok: true, status: 204, data: {} });
  });

  it('GET no manda cuerpo ni cabecera de contenido', async () => {
    const calls = mockApi({ sesion: { body: { rol: 'cliente' } } });
    await llamar('sesion', { method: 'GET' });
    expect(calls[0]!.body).toBeNull();
    expect(calls[0]!.headers).toEqual({});
  });

  it('un error de la API conserva su código, mensaje, campos y tiempo de espera', async () => {
    mockApi({
      acceso: {
        status: 429,
        headers: { 'retry-after': '90' },
        body: { codigo: 'demasiados_intentos', mensaje: 'Espera' },
      },
    });
    expect(await llamar('acceso', { body: {} })).toEqual({
      ok: false,
      status: 429,
      error: { codigo: 'demasiados_intentos', mensaje: 'Espera' },
      retryAfterSeconds: 90,
    });
  });

  it('un cuerpo de error con otra forma se trata como servicio no disponible', async () => {
    mockApi({ acceso: { status: 500, body: { raro: true } } });
    const result = await llamar('acceso', { body: {} });
    expect(result).toMatchObject({ ok: false, error: { codigo: 'servicio_no_disponible' } });
  });

  it('si la red falla devuelve un error con la misma forma, sin lanzar', async () => {
    mockApi({ acceso: { fail: true } });
    const result = await llamar('acceso', { body: {} });
    expect(result).toMatchObject({
      ok: false,
      status: 0,
      error: { codigo: 'servicio_no_disponible' },
    });
    expect(result.ok === false && result.error.mensaje).toMatch(/conexión/);
  });
});

describe('validar y camposPorNombre', () => {
  it('devuelve los datos normalizados cuando son válidos', () => {
    const result = validar(registroRequest, {
      nombre: ' Ana ',
      correo: 'ANA@Ejemplo.com',
      contrasena: 'una frase bastante larga',
      aceptaPolitica: true,
    });
    expect(result).toMatchObject({ ok: true, data: { nombre: 'Ana', correo: 'ana@ejemplo.com' } });
  });

  it('devuelve un mensaje por campo con los mismos textos que la API', () => {
    const result = validar(registroRequest, {
      nombre: '',
      correo: 'x',
      contrasena: 'corta',
      aceptaPolitica: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.campos).sort()).toEqual(
        ['aceptaPolitica', 'contrasena', 'correo', 'nombre'].sort(),
      );
      expect(result.campos['contrasena']).toMatch(/al menos 12/);
    }
  });

  it('con varios fallos en un campo muestra el primero', () => {
    expect(
      camposPorNombre([
        { campo: 'a', mensaje: 'primero' },
        { campo: 'a', mensaje: 'segundo' },
      ]),
    ).toEqual({ a: 'primero' });
    expect(camposPorNombre(undefined)).toEqual({});
  });
});

describe('esperaLegible', () => {
  it.each([
    [undefined, 'un momento'],
    [0, 'un momento'],
    [30, 'un minuto'],
    [60, 'un minuto'],
    [61, '2 minutos'],
    [900, '15 minutos'],
  ])('%s s → «%s»', (seconds, text) => {
    expect(esperaLegible(seconds)).toBe(text);
  });
});
