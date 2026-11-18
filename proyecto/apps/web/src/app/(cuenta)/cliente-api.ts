import type { ZodType } from 'zod';
import { camposDeError } from '@cafeteria/contracts/cuenta';
import type { ErrorDeApi } from '@cafeteria/contracts/cuenta';

// Llamadas al puente same-origin `/api/auth/*` (ver server/auth-proxy.ts). Todo error vuelve con la
// misma forma, incluidos los fallos de red, para que las pantallas solo tengan un caso que pintar.

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: ErrorDeApi; retryAfterSeconds?: number };

const UNAVAILABLE: ErrorDeApi = {
  codigo: 'servicio_no_disponible',
  mensaje: 'No pudimos conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.',
};

export async function llamar<T = Record<string, never>>(
  ruta: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; csrf?: string } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`/api/auth/${ruta}`, {
      method: options.method ?? 'POST',
      credentials: 'same-origin',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.csrf ? { 'x-csrf-token': options.csrf } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    const json: unknown = text ? JSON.parse(text) : {};
    if (response.ok) return { ok: true, status: response.status, data: json as T };
    const retry = Number(response.headers.get('retry-after'));
    return {
      ok: false,
      status: response.status,
      error: isApiError(json) ? json : UNAVAILABLE,
      ...(Number.isFinite(retry) && retry > 0 ? { retryAfterSeconds: retry } : {}),
    };
  } catch {
    return { ok: false, status: 0, error: UNAVAILABLE };
  }
}

function isApiError(value: unknown): value is ErrorDeApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'codigo' in value &&
    typeof value.codigo === 'string' &&
    'mensaje' in value &&
    typeof value.mensaje === 'string'
  );
}

/** Valida en el navegador con los mismos esquemas que la API: los mensajes son idénticos. */
export function validar<T>(
  schema: ZodType<T>,
  values: unknown,
): { ok: true; data: T } | { ok: false; campos: Record<string, string> } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, campos: camposPorNombre(camposDeError(result.error).campos) };
}

export function camposPorNombre(campos: ErrorDeApi['campos']): Record<string, string> {
  const byName: Record<string, string> = {};
  // Un campo con varios fallos muestra el primero: es el que hay que corregir antes.
  for (const item of campos ?? []) byName[item.campo] ??= item.mensaje;
  return byName;
}

/** Cuánto esperar, dicho en lenguaje claro. */
export function esperaLegible(seconds: number | undefined): string {
  if (!seconds) return 'un momento';
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? 'un minuto' : `${minutes} minutos`;
}
