import { hash, verify } from '@node-rs/argon2';
import type { MailPort } from '../notificaciones/index.js';
import type { PasswordRejection } from './password-policy.js';

// Piezas compartidas de los servicios de autenticación: errores con forma de respuesta, hash de
// contraseñas y envío de correo en segundo plano.

export interface RequestContext {
  /** IP de origen tal como la ve la API (se trunca antes de registrarla). */
  ip?: string | undefined;
  agente?: string | undefined;
}

/** Error de negocio con el código HTTP y el cuerpo que verá la persona; sin datos sensibles. */
export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 410 | 429 | 503,
    readonly codigo: string,
    readonly mensaje: string,
    readonly options: {
      campos?: { campo: string; mensaje: string }[];
      retryAfterSeconds?: number;
    } = {},
  ) {
    super(codigo);
    this.name = 'AuthError';
  }
}

export const tooManyAttempts = (retryAfterSeconds: number) =>
  new AuthError(
    429,
    'demasiados_intentos',
    'Hubo demasiados intentos. Espera un momento antes de volver a intentarlo.',
    { retryAfterSeconds },
  );

/** Mensajes de la política de contraseñas: dicen cómo corregir y no revelan nada de ninguna cuenta. */
export const PASSWORD_MESSAGES: Record<PasswordRejection, string> = {
  corta: 'Usa al menos 12 caracteres. Una frase corta que solo tú conozcas funciona bien.',
  larga: 'Usa como máximo 128 caracteres.',
  comun:
    'Esa contraseña es demasiado común o fácil de adivinar. Prueba una frase larga y poco habitual.',
  personal: 'No uses tu nombre ni tu correo dentro de la contraseña.',
  filtrada: 'Esa contraseña apareció en filtraciones de datos. Elige una distinta.',
};

export const passwordError = (motivo: PasswordRejection, campo = 'contrasena') =>
  new AuthError(400, 'datos_invalidos', 'Revisa los campos marcados.', {
    campos: [{ campo, mensaje: PASSWORD_MESSAGES[motivo] }],
  });

// Argon2id con los mínimos de OWASP (19 MiB, 2 pasadas, 1 hilo); algorithm 2 = Argon2id.
const ARGON = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain.normalize('NFKC'), ARGON);

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain.normalize('NFKC'));
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;
/**
 * Verifica contra un hash ficticio cuando la cuenta no existe, para que «cuenta inexistente» y
 * «contraseña incorrecta» tarden lo mismo (FR-006, research D-07).
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummy ??= hashPassword('contraseña-ficticia-que-nadie-usa');
  await verifyPassword(await dummy, plain);
}

/**
 * Envía correos sin hacer esperar la respuesta (el tiempo de envío no debe delatar si la cuenta
 * existe). Un fallo de envío no rompe el flujo: la persona puede pedir el enlace otra vez.
 */
export class BackgroundMail {
  private readonly pending = new Set<Promise<void>>();
  failures = 0;

  constructor(private readonly mail: MailPort) {}

  send(mail: Parameters<MailPort['send']>[0]): void {
    const task = this.mail.send(mail).catch(() => {
      this.failures += 1;
    });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  }

  /** Espera a que terminen los envíos en curso (pruebas y apagado ordenado). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }
}

export const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
