const unavailable = () =>
  Response.json(
    { status: 'unavailable', version: 'unknown' },
    {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );

// The sole allowed upstream is the server's configured origin, never a URL
// supplied in a browser query, path, header or body. Redirects are forbidden.
export async function proxyHealth(
  configuredOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  try {
    const origin = new URL(configuredOrigin);
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.username ||
      origin.password ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash
    )
      return unavailable();
    const response = await fetcher(new URL('/health', origin.origin).href, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(3500),
    });
    if (![200, 503].includes(response.status)) return unavailable();
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== 'object' ||
      !('status' in body) ||
      !('version' in body) ||
      typeof body.version !== 'string' ||
      body.version.length === 0 ||
      body.version.length > 100 ||
      body.status !== (response.status === 200 ? 'ok' : 'unavailable')
    )
      return unavailable();
    return Response.json(
      { status: body.status, version: body.version },
      {
        status: response.status,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch {
    return unavailable();
  }
}
