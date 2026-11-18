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
const FORWARDED_REQUEST_HEADERS = ['content-type', 'cookie', 'x-csrf-token', 'user-agent'];
const RETURNED_RESPONSE_HEADERS = ['content-type', 'retry-after'];

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

/** Solo estas cabeceras salen hacia la API: nada de Authorization, Host ni otras. */
function forwardedHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  const ip = clientIp(request.headers);
  if (ip) headers['x-forwarded-for'] = ip;
  return headers;
}

/** Devuelve la respuesta de la API con las cabeceras permitidas y todas sus cookies. */
async function relay(upstream: Response): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) headers.append('set-cookie', cookie);
  // 204 y 304 no llevan cuerpo.
  const body = [204, 304].includes(upstream.status) ? null : await upstream.text();
  return new Response(body, { status: upstream.status, headers });
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

  const body = request.method === 'GET' ? undefined : await request.text();
  if (body !== undefined && new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return Response.json(
      { codigo: 'datos_invalidos', mensaje: 'La solicitud es demasiado grande.' },
      { status: 413 },
    );

  try {
    return await relay(
      await fetcher(new URL(`/api/auth/${route}`, apiOrigin).href, {
        method: request.method,
        headers: forwardedHeaders(request),
        ...(body !== undefined ? { body } : {}),
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(8000),
      }),
    );
  } catch {
    return unavailable();
  }
}
