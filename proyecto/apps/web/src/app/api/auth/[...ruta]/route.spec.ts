import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../server/config.ts', () => ({
  readWebConfig: () => ({ apiBaseUrl: 'http://api.interna:3001' }),
}));

import { GET, POST } from './route.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

// El manejador resuelve la ruta dinámica y delega en el puente con la API configurada en el servidor.
describe('ruta /api/auth/[...ruta]', () => {
  it('POST reenvía a la API configurada con la ruta pedida', async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetcher);
    const response = await POST(
      new Request('http://web/api/auth/acceso', { method: 'POST', body: '{}' }),
      { params: Promise.resolve({ ruta: ['acceso'] }) },
    );
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual([
      'http://api.interna:3001/api/auth/acceso',
      expect.objectContaining({ method: 'POST' }),
    ]);
  });

  it('GET de una ruta que solo admite POST responde 405 sin tocar la API', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(new Request('http://web/api/auth/acceso'), {
      params: Promise.resolve({ ruta: ['acceso'] }),
    });
    expect(response.status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('una ruta fuera de la lista responde 404', async () => {
    const response = await GET(new Request('http://web/api/auth/otra'), {
      params: Promise.resolve({ ruta: ['otra'] }),
    });
    expect(response.status).toBe(404);
  });
});
