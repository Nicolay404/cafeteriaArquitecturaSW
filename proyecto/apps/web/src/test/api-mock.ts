import { vi } from 'vitest';

// Doble de `fetch` para probar las pantallas de cuenta sin API: cada ruta `/api/auth/<ruta>`
// responde lo que diga la prueba y se guardan las llamadas para comprobar qué se envió.
export interface MockReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Simula que la red falla. */
  fail?: boolean;
}

export interface MockCall {
  ruta: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

export function mockApi(routes: Record<string, MockReply | ((call: MockCall) => MockReply)>) {
  const calls: MockCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const ruta = String(input).replace('/api/auth/', '');
      const call: MockCall = {
        ruta,
        method: init.method ?? 'GET',
        body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        headers: (init.headers ?? {}) as Record<string, string>,
      };
      calls.push(call);
      const route = routes[ruta];
      const reply = typeof route === 'function' ? route(call) : (route ?? { status: 404 });
      if (reply.fail) throw new TypeError('Failed to fetch');
      const status = reply.status ?? 200;
      return new Response(status === 204 ? null : JSON.stringify(reply.body ?? {}), {
        status,
        headers: reply.headers ?? {},
      });
    }),
  );
  return calls;
}

/** `window.location.assign` no navega en jsdom: se sustituye por un espía. */
export function mockLocation() {
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  return assign;
}
