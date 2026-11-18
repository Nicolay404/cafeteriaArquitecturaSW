import { describe, expect, it } from 'vitest';
import { proxyAuth } from './auth-proxy.ts';

// Puente web → API de identidad: lista cerrada de rutas, destino fijo y cookies intactas.
const API = 'http://api.interna:3001';
interface Call {
  url: string;
  init: RequestInit;
}

const upstream = (response: Response, calls: Call[] = []): typeof fetch =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as typeof fetch;

const post = (body = '{"a":1}', headers: Record<string, string> = {}) =>
  new Request('http://web/api/auth/x', { method: 'POST', body, headers });

describe('proxyAuth', () => {
  it('reenvía solo a la API configurada y a la ruta pedida', async () => {
    const calls: Call[] = [];
    const response = await proxyAuth(
      post(),
      ['acceso'],
      API,
      upstream(Response.json({ ok: true }, { status: 200 }), calls),
    );
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://api.interna:3001/api/auth/acceso');
    expect(calls[0]!.init.redirect).toBe('error');
  });

  it.each([
    [['otra']],
    [['acceso', 'extra']],
    [[]],
    [['..', 'platform']],
    [['__proto__']],
    [['constructor']],
  ])('rechaza la ruta %j sin llamar a la API', async (segments) => {
    const calls: Call[] = [];
    const response = await proxyAuth(post(), segments, API, upstream(new Response('x'), calls));
    expect(response.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('solo admite el método de cada ruta', async () => {
    const calls: Call[] = [];
    const getAcceso = await proxyAuth(
      new Request('http://web/x'),
      ['acceso'],
      API,
      upstream(new Response('x'), calls),
    );
    expect(getAcceso.status).toBe(405);
    expect(getAcceso.headers.get('allow')).toBe('POST');
    const postSesion = await proxyAuth(post(), ['sesion'], API, upstream(new Response('x'), calls));
    expect(postSesion.status).toBe(405);
    expect(calls).toEqual([]);
  });

  it('pasa cookie, CSRF, agente e IP del visitante, y no otras cabeceras', async () => {
    const calls: Call[] = [];
    await proxyAuth(
      post('{}', {
        'content-type': 'application/json',
        cookie: 'sid=abc',
        'x-csrf-token': 'tok',
        'user-agent': 'Navegador',
        'x-forwarded-for': '203.0.113.9, 10.0.0.1',
        authorization: 'Bearer secreto',
      }),
      ['cierre'],
      API,
      upstream(new Response(null, { status: 204 }), calls),
    );
    expect(calls[0]!.init.headers).toEqual({
      'content-type': 'application/json',
      cookie: 'sid=abc',
      'x-csrf-token': 'tok',
      'user-agent': 'Navegador',
      'x-forwarded-for': '203.0.113.9',
    });
  });

  it('devuelve las cookies de la API, Retry-After y no deja cachear', async () => {
    const headers = new Headers({ 'retry-after': '120', 'content-type': 'application/json' });
    headers.append('set-cookie', 'sid=1; Path=/; HttpOnly; SameSite=Lax');
    headers.append('set-cookie', 'otra=2; Path=/');
    const response = await proxyAuth(
      post(),
      ['acceso'],
      API,
      upstream(new Response('{"codigo":"demasiados_intentos"}', { status: 429, headers })),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.getSetCookie()).toEqual([
      'sid=1; Path=/; HttpOnly; SameSite=Lax',
      'otra=2; Path=/',
    ]);
    expect(await response.json()).toEqual({ codigo: 'demasiados_intentos' });
  });

  it('un 204 sale sin cuerpo', async () => {
    const response = await proxyAuth(
      post(),
      ['cierre'],
      API,
      upstream(new Response(null, { status: 204 })),
    );
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('rechaza cuerpos de más de 10 kB sin llamar a la API', async () => {
    const calls: Call[] = [];
    const response = await proxyAuth(
      post('x'.repeat(10_001)),
      ['registro'],
      API,
      upstream(new Response('x'), calls),
    );
    expect(response.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('si la API no responde devuelve 503 con un mensaje que dice qué hacer', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED 10.0.0.5:3001');
    }) as typeof fetch;
    const response = await proxyAuth(post(), ['acceso'], API, failing);
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).toContain('Inténtalo de nuevo');
    expect(text).not.toContain('10.0.0.5');
  });
});
