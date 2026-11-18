// Puente same-origin entre el navegador y la API de identidad (Spec #2). El navegador solo habla
// con la web, así la cookie de sesión `sid` queda en el origen de la web y no hace falta CORS. La
// ÚNICA URL de destino es la API configurada en el servidor (nunca algo que venga del navegador) y
// solo pasan las rutas de una lista cerrada, con sus métodos. Sin redirecciones.

const ALLOWED: Record<string, readonly string[]> = {
  registro: ['POST'],
  'confirmar-correo': ['POST'],
  'reenviar-confirmacion': ['POST'],
  acceso: ['POST'],
  cierre: ['POST'],
  recuperar: ['POST'],
  restablecer: ['POST'],
  sesion: ['GET'],
};

const MAX_BODY_BYTES = 10_000;

const unavailable = () =>
  Response.json(
    {
      codigo: 'servicio_no_disponible',
      mensaje: 'No pudimos conectar con el servicio. Inténtalo de nuevo en un momento.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );

const notFound = () =>
  Response.json({ codigo: 'no_encontrado', mensaje: 'No existe.' }, { status: 404 });

/** IP del visitante según el borde (primer valor de X-Forwarded-For); la API la trunca al registrarla. */
function clientIp(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || headers.get('x-real-ip')?.trim() || undefined;
}

export async function proxyAuth(
  request: Request,
  segments: readonly string[],
  apiOrigin: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const [route, ...extra] = segments;
  if (!route || extra.length > 0 || !Object.hasOwn(ALLOWED, route)) return notFound();
  const methods = ALLOWED[route]!;
  if (!methods.includes(request.method))
    return Response.json(
      { codigo: 'metodo_no_permitido', mensaje: 'Método no permitido.' },
      { status: 405, headers: { Allow: methods.join(', ') } },
    );

  let body: string | undefined;
  if (request.method !== 'GET') {
    body = await request.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES)
      return Response.json(
        { codigo: 'datos_invalidos', mensaje: 'La solicitud es demasiado grande.' },
        { status: 413 },
      );
  }

  const headers: Record<string, string> = {};
  for (const name of ['content-type', 'cookie', 'x-csrf-token', 'user-agent']) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const ip = clientIp(request.headers);
  if (ip) headers['x-forwarded-for'] = ip;

  try {
    const upstream = await fetcher(new URL(`/api/auth/${route}`, apiOrigin).href, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    const out = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) out.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);
    // 204 y 304 no llevan cuerpo.
    return new Response([204, 304].includes(upstream.status) ? null : await upstream.text(), {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return unavailable();
  }
}
