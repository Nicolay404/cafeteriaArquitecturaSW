import { z } from 'zod';
import { contrasenaNueva, correo, nombre } from './identidad.js';

// Spec #2 — contrato HTTP de Clientes. Solo datos del propio cliente: el id sale de la sesión.

/** Teléfono opcional en formato E.164. */
export const telefono = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, {
    error: 'Escribe el teléfono con el prefijo del país, por ejemplo +593991234567.',
  });

export const perfilPatch = z
  .object({
    nombre: nombre.optional(),
    telefono: telefono.nullable().optional(),
    preferencias: z.record(z.string().max(40), z.string().max(200)).optional(),
  })
  .strict();

export const cambioCorreoRequest = z.object({ correoNuevo: correo });
export const cambioContrasenaRequest = z.object({
  actual: z.string().min(1, { error: 'Escribe tu contraseña actual.' }),
  nueva: contrasenaNueva,
});

export const FINALIDADES_OPCIONALES = ['marketing', 'personalizacion'] as const;
export const consentimientoRequest = z.object({ estado: z.enum(['otorgado', 'retirado']) });

export const ESTADOS_PEDIDO_VISIBLES = [
  'pendiente',
  'en_preparacion',
  'listo',
  'entregado',
  'cancelado',
] as const;
export const pedidoResumen = z.object({
  id: z.string(),
  fecha: z.iso.datetime(),
  /** Total en centavos: nunca coma flotante (constitución VI). */
  totalCentavos: z.number().int().nonnegative(),
  estado: z.enum(ESTADOS_PEDIDO_VISIBLES),
});

export const eliminacionRequest = z.object({
  confirmacion: z.literal('ELIMINAR', { error: 'Escribe ELIMINAR para confirmar.' }),
});

export const EXPORT_FORMAT = 'cafeteria-export/1' as const;

export type PerfilPatch = z.infer<typeof perfilPatch>;
export type PedidoResumen = z.infer<typeof pedidoResumen>;
