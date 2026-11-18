import { describe, expect, it, jest } from '@jest/globals';
import { HttpException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { evaluateAccess } from './access.js';
import type { AccessRule } from './access.js';
import { AccessGuard, readCookie } from './guards.js';
import type { GuardedRequest } from './guards.js';
import { SecurityEvents, sanitizeDetail, summarizeAgent, truncateIp } from './security-events.js';
import { SessionStoreUnavailableError } from './sessions.js';
import type { Session, SessionStore } from './sessions.js';

// T013 — la decisión de acceso por rol, MFA y reautenticación, el guard que la aplica y los
// eventos de seguridad sin datos sensibles.
const NOW = 1_800_000_000_000;
const session = (overrides: Partial<Session> = {}): Session => ({
  cuentaId: 'c1',
  rol: 'cliente',
  mfaVerificado: false,
  autenticadoEn: NOW,
  creadaEn: NOW,
  csrf: 'csrf-token',
  ...overrides,
});

describe('evaluateAccess', () => {
  it('sin sesión: 401', () => {
    expect(evaluateAccess(null, {}, NOW)).toMatchObject({ ok: false, status: 401 });
  });

  it('un cliente no entra a una función de personal ni de admin', () => {
    const rule: AccessRule = { roles: ['personal', 'admin'] };
    expect(evaluateAccess(session(), rule, NOW)).toMatchObject({
      ok: false,
      status: 403,
      codigo: 'rol_no_permitido',
    });
  });

  it('personal no entra a una función de administrador', () => {
    const staff = session({ rol: 'personal', mfaVerificado: true });
    expect(evaluateAccess(staff, { roles: ['admin'] }, NOW)).toMatchObject({
      ok: false,
      codigo: 'rol_no_permitido',
    });
    expect(evaluateAccess(staff, { roles: ['personal', 'admin'] }, NOW)).toEqual({ ok: true });
  });

  it.each(['personal', 'admin'] as const)(
    '%s sin segundo factor verificado: 403 mfa_requerido',
    (rol) => {
      expect(evaluateAccess(session({ rol }), {}, NOW)).toMatchObject({
        ok: false,
        status: 403,
        codigo: 'mfa_requerido',
      });
    },
  );

  it('las rutas del flujo de MFA admiten la sesión parcial; las demás no', () => {
    const partial = session({ rol: 'admin' });
    expect(evaluateAccess(partial, { allowPartialMfa: true }, NOW)).toEqual({ ok: true });
    expect(evaluateAccess(partial, { roles: ['admin'] }, NOW)).toMatchObject({ ok: false });
  });

  it('el rol se comprueba antes que el MFA: no se revela nada a quien no debe ver la función', () => {
    expect(evaluateAccess(session({ rol: 'personal' }), { roles: ['admin'] }, NOW)).toMatchObject({
      codigo: 'rol_no_permitido',
    });
  });

  it('un cliente no necesita MFA', () => {
    expect(evaluateAccess(session(), {}, NOW)).toEqual({ ok: true });
  });

  it('las acciones sensibles piden haber confirmado la contraseña hace poco', () => {
    const rule: AccessRule = { reauthSeconds: 300 };
    expect(evaluateAccess(session({ autenticadoEn: NOW - 299_000 }), rule, NOW)).toEqual({
      ok: true,
    });
    expect(evaluateAccess(session({ autenticadoEn: NOW - 301_000 }), rule, NOW)).toMatchObject({
      ok: false,
      codigo: 'reautenticacion_requerida',
    });
  });

  it('los mensajes dicen qué hacer', () => {
    const denial = evaluateAccess(null, {}, NOW);
    expect(denial.ok === false && denial.mensaje).toMatch(/Inicia sesión/);
  });
});

describe('readCookie', () => {
  it('lee la cookie por nombre exacto', () => {
    expect(readCookie('a=1; sid=abc; b=2', 'sid')).toBe('abc');
    expect(readCookie('xsid=abc', 'sid')).toBeUndefined();
    expect(readCookie(['a=1', 'sid=z'], 'sid')).toBe('z');
    expect(readCookie(undefined, 'sid')).toBeUndefined();
    expect(readCookie('sid=%E0%A4%A', 'sid')).toBeUndefined();
  });
});

describe('AccessGuard', () => {
  const events = { record: jest.fn(async () => undefined) } as unknown as SecurityEvents;
  const build = (options: {
    rule?: AccessRule | undefined;
    session?: Session | null | Error;
    csrfOk?: boolean;
  }) => {
    const sessions = {
      get: jest.fn(async () => {
        if (options.session instanceof Error) throw options.session;
        return options.session ?? null;
      }),
      verifyCsrf: jest.fn(() => options.csrfOk ?? true),
    } as unknown as SessionStore;
    const reflector = { getAllAndOverride: () => options.rule } as unknown as Reflector;
    return { guard: new AccessGuard(reflector, sessions, events, () => NOW), sessions };
  };
  const context = (request: Partial<GuardedRequest>) => {
    const full: GuardedRequest = {
      method: 'GET',
      headers: { cookie: 'sid=' + 'a'.repeat(43) },
      ip: '203.0.113.9',
      ...request,
    };
    return {
      request: full,
      context: {
        getHandler: () => undefined,
        getClass: () => undefined,
        switchToHttp: () => ({ getRequest: () => full }),
      } as unknown as ExecutionContext,
    };
  };
  const failure = async (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error as HttpException,
    );

  it('las rutas sin @Access son públicas', async () => {
    const { guard, sessions } = build({ rule: undefined });
    expect(await guard.canActivate(context({}).context)).toBe(true);
    expect(sessions.get).not.toHaveBeenCalled();
  });

  it('sin sesión devuelve 401 y no registra evento', async () => {
    (events.record as jest.Mock).mockClear();
    const { guard } = build({ rule: {}, session: null });
    const error = await failure(guard.canActivate(context({}).context));
    expect(error?.getStatus()).toBe(401);
    expect(events.record).not.toHaveBeenCalled();
  });

  it('un 403 de una sesión válida queda registrado como acceso_denegado', async () => {
    (events.record as jest.Mock).mockClear();
    const { guard } = build({
      rule: { roles: ['admin'] },
      session: session({ rol: 'personal', mfaVerificado: true }),
    });
    const error = await failure(guard.canActivate(context({}).context));
    expect(error?.getStatus()).toBe(403);
    expect(events.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'acceso_denegado',
        cuentaId: 'c1',
        ip: '203.0.113.9',
        detalle: { motivo: 'rol_no_permitido', rol: 'personal' },
      }),
    );
  });

  it('adjunta la sesión y el token a la petición cuando todo es correcto', async () => {
    const { guard } = build({ rule: {}, session: session() });
    const { request, context: ctx } = context({});
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(request.sesion?.cuentaId).toBe('c1');
    expect(request.sesionToken).toBe('a'.repeat(43));
  });

  it('exige el token CSRF en las operaciones que cambian estado', async () => {
    const { guard } = build({ rule: {}, session: session(), csrfOk: false });
    const error = await failure(guard.canActivate(context({ method: 'POST' }).context));
    expect(error?.getStatus()).toBe(403);
    expect(error?.getResponse()).toMatchObject({ codigo: 'csrf_invalido' });
    expect(await guard.canActivate(context({ method: 'GET' }).context)).toBe(true);
  });

  it('con el almacén de sesiones caído falla cerrado con 503', async () => {
    const { guard } = build({ rule: {}, session: new SessionStoreUnavailableError() });
    const error = await failure(guard.canActivate(context({}).context));
    expect(error?.getStatus()).toBe(503);
  });

  it('un error inesperado no se convierte en acceso', async () => {
    const { guard } = build({ rule: {}, session: new Error('raro') });
    const error = await failure(guard.canActivate(context({}).context));
    expect(error?.message).toBe('raro');
  });
});

describe('eventos de seguridad', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['::ffff:198.51.100.5', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0db8:0000:0001:0000:0000:0000:0001', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['no-es-una-ip', null],
    ['', null],
    [undefined, null],
  ])('trunca la IP %s', (ip, expected) => {
    expect(truncateIp(ip)).toBe(expected);
  });

  it('resume el agente sin versión ni identificadores', () => {
    expect(
      summarizeAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.1 Safari/537.36',
      ),
    ).toBe('Chrome / Windows');
    expect(summarizeAgent(undefined)).toBeNull();
    expect(summarizeAgent('rareza')).toBe('otro / otro');
  });

  it('descarta del detalle todo lo que parezca un secreto o un dato personal', () => {
    expect(
      sanitizeDetail({
        motivo: 'x',
        contrasena: 'a',
        password: 'a',
        token: 't',
        codigoRecuperacion: 'c',
        clave: 'k',
        correo: 'a@b.ec',
        email: 'a@b.ec',
        nombre: 'Ana',
        telefono: '+593',
        intento: 3,
        largo: 'z'.repeat(500),
      }),
    ).toEqual({ motivo: 'x', intento: 3, largo: 'z'.repeat(120) });
  });

  it('inserta cuenta, tipo, IP truncada, agente resumido y detalle saneado', async () => {
    const calls: Array<[string, unknown[] | undefined]> = [];
    const query = async (text: string, values?: unknown[]) => {
      calls.push([text, values]);
    };
    await new SecurityEvents({ query }).record({
      tipo: 'acceso_fallido',
      cuentaId: null,
      ip: '203.0.113.77',
      agente: 'Mozilla/5.0 (Linux) Firefox/120.0',
      detalle: { token: 'secreto', intento: 2 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toContain('INSERT INTO identity.evento_seguridad');
    expect(calls[0]![1]).toEqual([
      null,
      'acceso_fallido',
      '203.0.113.0/24',
      'Firefox / Linux',
      '{"intento":2}',
    ]);
  });
});
