import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyHealth } from './health-proxy.js';

afterEach(() => vi.restoreAllMocks());

describe('T014 — proxy de salud en runtime', () => {
  it.each([200, 503])('preserva %s/versión y solo envía campos del contrato', async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          status: status === 200 ? 'ok' : 'unavailable',
          version: 'sha-test',
          privateUrl: 'secret',
        },
        { status },
      ),
    );
    const response = await proxyHealth('http://127.0.0.1:3001', fetcher);
    expect(response.status).toBe(status);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({
      status: status === 200 ? 'ok' : 'unavailable',
      version: 'sha-test',
    });
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/health',
      expect.objectContaining({ cache: 'no-store', redirect: 'error' }),
    );
  });

  it.each([
    'file:///etc/passwd',
    'http://user:password@localhost',
    'http://localhost/path?url=evil',
    'http://localhost/#evil',
  ])('rechaza configuración no permitida: %s', async (origin) => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await proxyHealth(origin, fetcher);
    expect(response.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('no filtra errores de red ni redirige a otra URL', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('postgres://private:secret@internal'));
    const response = await proxyHealth('http://localhost:3001', fetcher);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', version: 'unknown' });
  });

  it('rechaza cuerpo inválido y estados inesperados', async () => {
    for (const response of [
      Response.json({ status: 'ok', version: 'x' }, { status: 500 }),
      Response.json({ status: 'ok', secret: 'x' }),
      new Response('not json'),
    ]) {
      const result = await proxyHealth(
        'http://localhost:3001',
        vi.fn<typeof fetch>().mockResolvedValue(response),
      );
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({ status: 'unavailable', version: 'unknown' });
    }
  });
});
