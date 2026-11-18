import type { Rol } from '../../../../../packages/contracts/src/identidad.js';
import type { Session } from './sessions.js';

// FR-007/FR-008, research D-10: la decisión de acceso es una función pura que se comprueba en el
// servidor en CADA operación. El rol vive en la sesión (que sale de la cuenta), nunca en lo que
// envía el cliente. Seguro por defecto: una sesión con el segundo factor pendiente (siempre el de
// personal y administradores; el de un cliente solo si lo activó) no sirve para ninguna función;
// solo las rutas del propio flujo de MFA pueden usarla.

export interface AccessRule {
  /** Roles autorizados; vacío o ausente = cualquier usuario autenticado. */
  roles?: readonly Rol[];
  /** Solo para las rutas de configurar o verificar el segundo factor. */
  allowPartialMfa?: boolean;
  /** La contraseña debe haberse confirmado hace menos de estos segundos (acciones sensibles). */
  reauthSeconds?: number;
}

export type AccessDenial = {
  status: 401 | 403;
  codigo: 'no_autenticado' | 'rol_no_permitido' | 'mfa_requerido' | 'reautenticacion_requerida';
  /** Dice qué hacer, no solo qué falló. */
  mensaje: string;
};

export type AccessDecision = { ok: true } | ({ ok: false } & AccessDenial);

const deny = (denial: AccessDenial): AccessDecision => ({ ok: false, ...denial });

export function evaluateAccess(
  session: Session | null,
  rule: AccessRule,
  now: number,
): AccessDecision {
  if (!session)
    return deny({
      status: 401,
      codigo: 'no_autenticado',
      mensaje: 'Inicia sesión para continuar.',
    });
  if (rule.roles && rule.roles.length > 0 && !rule.roles.includes(session.rol))
    return deny({
      status: 403,
      codigo: 'rol_no_permitido',
      mensaje: 'Tu cuenta no tiene permiso para esta función.',
    });
  if (!session.mfaVerificado && !rule.allowPartialMfa)
    return deny({
      status: 403,
      codigo: 'mfa_requerido',
      mensaje: 'Verifica tu segundo factor de autenticación para usar esta función.',
    });
  if (rule.reauthSeconds !== undefined && now - session.autenticadoEn > rule.reauthSeconds * 1000)
    return deny({
      status: 403,
      codigo: 'reautenticacion_requerida',
      mensaje: 'Confirma tu contraseña para realizar esta acción.',
    });
  return { ok: true };
}
