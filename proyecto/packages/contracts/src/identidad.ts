import { z } from 'zod';

// Spec #2 — contrato HTTP de Identidad (specs/002-identidad-clientes/contracts/identidad-clientes.md).
// La API valida con estos esquemas y la web los reutiliza para mostrar los mismos errores.

/** Correo normalizado: sin espacios alrededor, NFKC y minúsculas. */
export const normalizeEmail = (value: string) => value.normalize('NFKC').trim().toLowerCase();

export const correo = z
  .string({ error: 'Escribe tu correo electrónico.' })
  .transform(normalizeEmail)
  .pipe(
    z
      .email({ error: 'Escribe un correo con el formato nombre@dominio.com.' })
      .max(254, { error: 'El correo no puede tener más de 254 caracteres.' }),
  );

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Solo longitud: las listas de comunes y filtradas se comprueban en el servidor (FR-004). */
export const contrasenaNueva = z
  .string({ error: 'Escribe una contraseña.' })
  .transform((value) => value.normalize('NFKC'))
  .pipe(
    z
      .string()
      .min(PASSWORD_MIN, { error: `Usa al menos ${PASSWORD_MIN} caracteres.` })
      .max(PASSWORD_MAX, { error: `Usa como máximo ${PASSWORD_MAX} caracteres.` }),
  );

export const nombre = z
  .string({ error: 'Escribe tu nombre.' })
  .trim()
  .min(1, { error: 'Escribe tu nombre.' })
  .max(120, { error: 'El nombre no puede tener más de 120 caracteres.' });

/** Token de un solo uso: 256 bits en base64url (43 caracteres). */
export const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'El enlace no es válido.' });

export const registroRequest = z.object({
  nombre,
  correo,
  contrasena: contrasenaNueva,
  aceptaPolitica: z.literal(true, {
    error: 'Para crear la cuenta debes aceptar la política de privacidad.',
  }),
});

export const accesoRequest = z.object({
  correo,
  // Al iniciar sesión no se aplica la política de longitud: no se revela nada sobre la cuenta.
  contrasena: z
    .string()
    .min(1, { error: 'Escribe tu contraseña.' })
    .max(PASSWORD_MAX * 4),
});

export const correoRequest = z.object({ correo });
export const tokenRequest = z.object({ token });
export const restablecerRequest = z.object({ token, contrasena: contrasenaNueva });

export const codigoMfa = z
  .string()
  .regex(/^\d{6}$/, { error: 'Escribe los 6 dígitos del código.' });
export const codigoRecuperacion = z
  .string()
  .regex(/^[a-z0-9]{5}-[a-z0-9]{5}$/, { error: 'Escribe el código con el formato xxxxx-xxxxx.' });
export const mfaVerificarRequest = z.union([
  z.object({ codigo: codigoMfa }),
  z.object({ codigoRecuperacion }),
]);

export const ROLES = ['cliente', 'personal', 'admin'] as const;
export type Rol = (typeof ROLES)[number];

export const personalRequest = z.object({ nombre, correo });

export const sesionResponse = z.object({
  rol: z.enum(ROLES),
  nombre: z.string(),
  mfaVerificado: z.boolean(),
});

/** Forma única de los errores de la API: `mensaje` dice cómo corregir. */
export interface ErrorDeApi {
  codigo: string;
  mensaje: string;
  campos?: { campo: string; mensaje: string }[];
}

/** Convierte un error de zod en la forma de la API, con cada campo y su mensaje. */
export function camposDeError(error: z.ZodError): ErrorDeApi {
  return {
    codigo: 'datos_invalidos',
    mensaje: 'Revisa los campos marcados.',
    campos: error.issues.map((issue) => ({
      campo: issue.path.map(String).join('.') || 'formulario',
      mensaje: issue.message,
    })),
  };
}

export type RegistroRequest = z.infer<typeof registroRequest>;
export type AccesoRequest = z.infer<typeof accesoRequest>;
export type SesionResponse = z.infer<typeof sesionResponse>;
