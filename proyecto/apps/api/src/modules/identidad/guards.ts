import { HttpException, SetMetadata } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { evaluateAccess } from './access.js';
import type { AccessRule } from './access.js';
import type { SecurityEvents } from './security-events.js';
import { SessionStoreUnavailableError } from './sessions.js';
import type { Session, SessionStore } from './sessions.js';

// Guard de acceso (FR-007, research D-10). Solo actúa en las rutas marcadas con @Access(): las
// demás son públicas a propósito (registro, acceso, recuperación). `@Access({})` significa «cualquier
// usuario autenticado»; con `roles` se restringe, y personal/admin exigen MFA verificado salvo en
// las rutas del propio flujo de MFA (`allowPartialMfa`).

export const ACCESS_KEY = 'identidad:acceso';
export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';

export const Access = (rule: AccessRule = {}) => SetMetadata(ACCESS_KEY, rule);

/** Petición mínima que necesita el guard (compatible con Express sin importar sus tipos). */
export interface GuardedRequest {
  method: string;
  ip?: string | undefined;
  headers: Record<string, string | string[] | undefined>;
  sesion?: Session;
  sesionToken?: string;
}

export function readCookie(
  header: string | string[] | undefined,
  name: string,
): string | undefined {
  const text = Array.isArray(header) ? header.join(';') : header;
  if (!text) return undefined;
  for (const part of text.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const header = (request: GuardedRequest, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const reject = (status: number, codigo: string, mensaje: string) =>
  new HttpException({ codigo, mensaje }, status);

export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionStore,
    private readonly events: SecurityEvents,
    private readonly now: () => number = Date.now,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const request = context.switchToHttp().getRequest<GuardedRequest>();
    const token = readCookie(request.headers['cookie'], SESSION_COOKIE);
    let session: Session | null;
    try {
      session = await this.sessions.get(token);
    } catch (error) {
      // Sin almacén de sesiones no se puede autorizar: falla cerrado, nunca deja pasar.
      if (error instanceof SessionStoreUnavailableError)
        throw reject(
          503,
          'servicio_no_disponible',
          'No pudimos comprobar tu sesión. Inténtalo en un momento.',
        );
      throw error;
    }

    const decision = evaluateAccess(session, rule, this.now());
    if (!decision.ok) {
      // Los accesos denegados de una sesión válida quedan registrados (US2.3); un 401 anónimo no.
      if (session && decision.status === 403)
        await this.events.record({
          tipo: 'acceso_denegado',
          cuentaId: session.cuentaId,
          ip: request.ip,
          agente: header(request, 'user-agent'),
          detalle: { motivo: decision.codigo, rol: session.rol },
        });
      throw reject(decision.status, decision.codigo, decision.mensaje);
    }

    if (session && !SAFE_METHODS.includes(request.method.toUpperCase()))
      if (!this.sessions.verifyCsrf(session, header(request, CSRF_HEADER)))
        throw reject(403, 'csrf_invalido', 'La página caducó. Recárgala e inténtalo de nuevo.');

    if (session) {
      request.sesion = session;
      if (token) request.sesionToken = token;
    }
    return true;
  }
}
