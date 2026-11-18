import type { Rol } from '../../../../../packages/contracts/src/identidad.js';
import type { TransactionalDb } from '../../../../../packages/contracts/src/db.js';
import type { PersonasRepository, PiiCipher } from '../clientes/index.js';
import { OneTimeTokens } from './one-time-tokens.js';
import type { PasswordPolicy } from './password-policy.js';
import type { RateLimiter } from './rate-limiter.js';
import type { SecurityEvents } from './security-events.js';
import type { SessionStore } from './sessions.js';
import {
  AuthError,
  BackgroundMail,
  hashPassword,
  passwordError,
  tooManyAttempts,
  verifyAgainstDummy,
  verifyPassword,
} from './auth-support.js';
import type { RequestContext } from './auth-support.js';
import { linkError } from './registration.service.js';

// US1: acceso, cierre de sesión y recuperación de contraseña (FR-003, FR-005, FR-006). Nada de lo
// que responde permite saber si un correo está registrado, salvo tras credenciales CORRECTAS
// (correo sin confirmar), y los bloqueos se avisan al titular una sola vez por ventana.

export interface LoginDeps {
  db: TransactionalDb;
  personas: PersonasRepository;
  cipher: PiiCipher;
  policy: PasswordPolicy;
  limiter: RateLimiter;
  sessions: SessionStore;
  events: SecurityEvents;
  mail: BackgroundMail;
  webOrigin: string;
}

const FAILED_BY_ACCOUNT = { limit: 5, windowSeconds: 15 * 60 };
const FAILED_BY_IP = { limit: 20, windowSeconds: 15 * 60 };
const BLOCK_NOTICE = { limit: 1, windowSeconds: 15 * 60 };
const RECOVERY_BY_ACCOUNT = { limit: 3, windowSeconds: 3600 };
const RECOVERY_BY_IP = { limit: 10, windowSeconds: 3600 };

const invalidCredentials = () =>
  new AuthError(
    401,
    'credenciales_invalidas',
    'El correo o la contraseña no son correctos. Revísalos e inténtalo de nuevo.',
  );

interface AccountRow {
  id: string;
  persona_id: string;
  hash_contrasena: string | null;
  rol: Rol;
  estado: 'pendiente' | 'activa' | 'desactivada';
  mfa_activado: boolean;
}

export interface LoginResult {
  /** Valor de la cookie de sesión. */
  token: string;
  csrf: string;
  rol: Rol;
  /** Falta verificar el segundo factor antes de usar funciones protegidas. */
  requiereMfa: boolean;
}

export class LoginService {
  constructor(private readonly deps: LoginDeps) {}

  async login(
    input: { correo: string; contrasena: string },
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const { db, cipher, limiter, sessions, events } = this.deps;
    const indice = cipher.blindIndex(input.correo);
    const accountKey = `acceso:cuenta:${indice}`;
    const ipKey = `acceso:ip:${ctx.ip ?? 'desconocida'}`;

    const [byAccount, byIp] = await Promise.all([
      limiter.status(accountKey, FAILED_BY_ACCOUNT),
      limiter.status(ipKey, FAILED_BY_IP),
    ]);
    if (!byAccount.allowed || !byIp.allowed) {
      if (!byAccount.allowed) await this.noticeBlock(indice, input.correo, ctx);
      throw tooManyAttempts(Math.max(byAccount.retryAfterSeconds, byIp.retryAfterSeconds));
    }

    const { rows } = await db.query<AccountRow>(
      `SELECT c.id, c.persona_id, c.hash_contrasena, c.rol, c.estado,
              (f.activado_en IS NOT NULL) AS mfa_activado
         FROM identity.cuenta c
         LEFT JOIN identity.segundo_factor f ON f.cuenta_id = c.id
        WHERE c.indice_correo = $1`,
      [indice],
    );
    const cuenta = rows[0];

    let valid = false;
    if (cuenta?.hash_contrasena)
      valid = await verifyPassword(cuenta.hash_contrasena, input.contrasena);
    else await verifyAgainstDummy(input.contrasena);

    // Cuenta desactivada = mismas credenciales inválidas: no se revela que existió.
    if (!cuenta || !valid || cuenta.estado === 'desactivada') {
      await Promise.all([
        limiter.record(accountKey, FAILED_BY_ACCOUNT),
        limiter.record(ipKey, FAILED_BY_IP),
      ]);
      await events.record({
        tipo: 'acceso_fallido',
        cuentaId: cuenta && cuenta.estado !== 'desactivada' ? cuenta.id : null,
        ip: ctx.ip,
        agente: ctx.agente,
      });
      throw invalidCredentials();
    }

    if (cuenta.estado === 'pendiente')
      throw new AuthError(
        403,
        'correo_sin_confirmar',
        'Aún no confirmaste tu correo. Revisa tu bandeja o pide que te enviemos el enlace otra vez.',
      );

    await limiter.reset(accountKey);
    // Personal y administradores siempre pasan por el segundo factor; un cliente solo si lo activó.
    const requiereMfa = cuenta.rol !== 'cliente' || cuenta.mfa_activado;
    const { token, session } = await sessions.create({
      cuentaId: cuenta.id,
      rol: cuenta.rol,
      mfaVerificado: !requiereMfa,
    });
    await events.record({ tipo: 'acceso_ok', cuentaId: cuenta.id, ip: ctx.ip, agente: ctx.agente });
    return { token, csrf: session.csrf, rol: cuenta.rol, requiereMfa };
  }

  /** Nombre para mostrar en la cabecera; `null` si la persona ya no existe. */
  async displayName(cuentaId: string): Promise<string | null> {
    const { rows } = await this.deps.db.query<{ persona_id: string }>(
      'SELECT persona_id FROM identity.cuenta WHERE id = $1',
      [cuentaId],
    );
    const personaId = rows[0]?.persona_id;
    return personaId ? ((await this.deps.personas.contactoDe(personaId))?.nombre ?? null) : null;
  }

  async logout(token: string | undefined): Promise<void> {
    await this.deps.sessions.destroy(token);
  }

  /** Pide el enlace de recuperación; devuelve siempre lo mismo exista o no la cuenta. */
  async requestRecovery(correo: string, ctx: RequestContext): Promise<void> {
    const { db, cipher, limiter, personas, mail, events } = this.deps;
    const indice = cipher.blindIndex(correo);
    const [byAccount, byIp] = await Promise.all([
      limiter.record(`recuperar:cuenta:${indice}`, RECOVERY_BY_ACCOUNT),
      limiter.record(`recuperar:ip:${ctx.ip ?? 'desconocida'}`, RECOVERY_BY_IP),
    ]);
    if (!byAccount.allowed || !byIp.allowed) return;

    const { rows } = await db.query<{ id: string; persona_id: string }>(
      `SELECT id, persona_id FROM identity.cuenta WHERE indice_correo = $1 AND estado = 'activa'`,
      [indice],
    );
    const cuenta = rows[0];
    if (!cuenta) return;
    const token = await new OneTimeTokens(db).issue(cuenta.id, 'recuperar');
    const contacto = await personas.contactoDe(cuenta.persona_id);
    mail.send({
      to: correo,
      kind: 'recuperar',
      data: {
        ...(contacto ? { nombre: contacto.nombre } : {}),
        enlace: `${this.deps.webOrigin}/restablecer?token=${token}`,
        minutos: 30,
      },
    });
    await events.record({
      tipo: 'recuperacion',
      cuentaId: cuenta.id,
      ip: ctx.ip,
      agente: ctx.agente,
    });
  }

  /**
   * Define la contraseña nueva con el enlace. Todo ocurre en una transacción: si la contraseña no
   * cumple la política, el enlace NO se consume y se puede volver a intentar.
   */
  async resetPassword(
    input: { token: string; contrasena: string },
    ctx: RequestContext,
  ): Promise<void> {
    const { db, personas, policy, sessions, limiter, cipher, events } = this.deps;
    const cuentaId = await db.transaction(async (tx) => {
      const result = await new OneTimeTokens(tx).redeem(input.token, 'recuperar');
      if (!result.ok) throw linkError(result.motivo);

      const { rows } = await tx.query<{ persona_id: string; estado: string }>(
        'SELECT persona_id, estado FROM identity.cuenta WHERE id = $1 FOR UPDATE',
        [result.cuentaId],
      );
      const cuenta = rows[0];
      if (!cuenta || cuenta.estado !== 'activa') throw linkError('invalido');

      const contacto = await personas.contactoDe(cuenta.persona_id);
      const verdict = await policy.check(input.contrasena, {
        ...(contacto ? { correo: contacto.correo, nombre: contacto.nombre } : {}),
      });
      if (!verdict.ok) throw passwordError(verdict.motivo);

      await tx.query(
        'UPDATE identity.cuenta SET hash_contrasena = $2, actualizada_en = now() WHERE id = $1',
        [result.cuentaId, await hashPassword(input.contrasena)],
      );
      if (contacto) await limiter.reset(`acceso:cuenta:${cipher.blindIndex(contacto.correo)}`);
      return result.cuentaId;
    });
    // Quien tenía la contraseña vieja (o una sesión robada) pierde el acceso al instante.
    await sessions.destroyAll(cuentaId);
    await events.record({
      tipo: 'restablecimiento',
      cuentaId,
      ip: ctx.ip,
      agente: ctx.agente,
    });
  }

  /** Avisa al titular de un bloqueo una sola vez por ventana y solo si la cuenta existe. */
  private async noticeBlock(indice: string, correo: string, ctx: RequestContext): Promise<void> {
    const { db, limiter, mail, events } = this.deps;
    const notice = await limiter.record(`aviso-bloqueo:${indice}`, BLOCK_NOTICE);
    if (!notice.allowed) return;
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM identity.cuenta WHERE indice_correo = $1',
      [indice],
    );
    const cuenta = rows[0];
    if (!cuenta) return;
    mail.send({ to: correo, kind: 'bloqueo', data: { minutos: 15 } });
    await events.record({ tipo: 'bloqueo', cuentaId: cuenta.id, ip: ctx.ip, agente: ctx.agente });
  }
}
