import type { TransactionalDb } from '../../../../../packages/contracts/src/db.js';
import type { PersonasRepository, PiiCipher } from '../clientes/index.js';
import { OneTimeTokens } from './one-time-tokens.js';
import type { PasswordPolicy } from './password-policy.js';
import type { RateLimiter } from './rate-limiter.js';
import type { SecurityEvents } from './security-events.js';
import {
  AuthError,
  BackgroundMail,
  hashPassword,
  isUniqueViolation,
  passwordError,
  tooManyAttempts,
} from './auth-support.js';
import type { RequestContext } from './auth-support.js';

// US1: registro, confirmación del correo y reenvío (FR-001, FR-002, FR-005, FR-006). Registrarse
// con un correo ya usado devuelve lo mismo que un registro nuevo y avisa al titular por correo.

export interface RegistrationDeps {
  db: TransactionalDb;
  personas: PersonasRepository;
  cipher: PiiCipher;
  policy: PasswordPolicy;
  limiter: RateLimiter;
  events: SecurityEvents;
  mail: BackgroundMail;
  /** Origen público de la web, para construir los enlaces de los correos. */
  webOrigin: string;
}

const REGISTRATION_RATE = { limit: 5, windowSeconds: 3600 };
const RESEND_RATE = { limit: 3, windowSeconds: 3600 };

export class RegistrationService {
  constructor(private readonly deps: RegistrationDeps) {}

  async register(
    input: { nombre: string; correo: string; contrasena: string },
    ctx: RequestContext,
  ): Promise<void> {
    const { db, personas, cipher, policy, limiter, events, mail } = this.deps;

    const rate = await limiter.record(`registro:ip:${ctx.ip ?? 'desconocida'}`, REGISTRATION_RATE);
    if (!rate.allowed) throw tooManyAttempts(rate.retryAfterSeconds);

    const verdict = await policy.check(input.contrasena, {
      correo: input.correo,
      nombre: input.nombre,
    });
    if (!verdict.ok) throw passwordError(verdict.motivo);

    // El hash se calcula SIEMPRE, exista o no la cuenta, para que ambas rutas tarden lo mismo.
    const passwordHash = await hashPassword(input.contrasena);
    const indice = cipher.blindIndex(input.correo);

    const existing = await db.query<{ id: string }>(
      'SELECT id FROM identity.cuenta WHERE indice_correo = $1',
      [indice],
    );
    if (existing.rows[0]) return this.notifyExisting(input.correo, ctx);

    let created: { cuentaId: string; token: string };
    try {
      created = await db.transaction(async (tx) => {
        const personaId = await personas.crear({ nombre: input.nombre, correo: input.correo }, tx);
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO identity.cuenta (persona_id, indice_correo, hash_contrasena, rol, estado)
           VALUES ($1, $2, $3, 'cliente', 'pendiente') RETURNING id`,
          [personaId, indice, passwordHash],
        );
        const cuentaId = rows[0]!.id;
        return { cuentaId, token: await new OneTimeTokens(tx).issue(cuentaId, 'confirmar_correo') };
      });
    } catch (error) {
      // Dos registros simultáneos con el mismo correo: gana uno y el otro se trata como «existente».
      if (isUniqueViolation(error)) return this.notifyExisting(input.correo, ctx);
      throw error;
    }

    mail.send({
      to: input.correo,
      kind: 'confirmar_correo',
      data: {
        nombre: input.nombre,
        enlace: `${this.deps.webOrigin}/confirmar?token=${created.token}`,
      },
    });
    await events.record({
      tipo: 'registro',
      cuentaId: created.cuentaId,
      ip: ctx.ip,
      agente: ctx.agente,
      detalle: { resultado: 'creada' },
    });
  }

  /** Confirma el correo con el enlace de un solo uso y activa la cuenta. */
  async confirmEmail(token: string): Promise<void> {
    const { db, events } = this.deps;
    const cuentaId = await db.transaction(async (tx) => {
      const result = await new OneTimeTokens(tx).redeem(token, 'confirmar_correo');
      if (!result.ok) throw linkError(result.motivo);
      await tx.query(
        `UPDATE identity.cuenta
            SET estado = 'activa', correo_confirmado_en = now(), actualizada_en = now()
          WHERE id = $1 AND estado = 'pendiente'`,
        [result.cuentaId],
      );
      return result.cuentaId;
    });
    await events.record({
      tipo: 'registro',
      cuentaId,
      detalle: { resultado: 'correo_confirmado' },
    });
  }

  /** Reenvía el enlace de confirmación; la respuesta es la misma exista o no la cuenta. */
  async resendConfirmation(correo: string, ctx: RequestContext): Promise<void> {
    const { db, cipher, limiter, mail, personas } = this.deps;
    const indice = cipher.blindIndex(correo);
    const byAccount = await limiter.record(`reenvio:cuenta:${indice}`, RESEND_RATE);
    const byIp = await limiter.record(`reenvio:ip:${ctx.ip ?? 'desconocida'}`, {
      limit: 10,
      windowSeconds: 3600,
    });
    if (!byAccount.allowed || !byIp.allowed) return;

    const { rows } = await db.query<{ id: string; persona_id: string }>(
      `SELECT id, persona_id FROM identity.cuenta WHERE indice_correo = $1 AND estado = 'pendiente'`,
      [indice],
    );
    const cuenta = rows[0];
    if (!cuenta) return;
    const token = await new OneTimeTokens(db).issue(cuenta.id, 'confirmar_correo');
    const contacto = await personas.contactoDe(cuenta.persona_id);
    mail.send({
      to: correo,
      kind: 'confirmar_correo',
      data: {
        ...(contacto ? { nombre: contacto.nombre } : {}),
        enlace: `${this.deps.webOrigin}/confirmar?token=${token}`,
      },
    });
  }

  private async notifyExisting(correo: string, ctx: RequestContext): Promise<void> {
    this.deps.mail.send({ to: correo, kind: 'cuenta_existente' });
    await this.deps.events.record({
      tipo: 'registro',
      cuentaId: null,
      ip: ctx.ip,
      agente: ctx.agente,
      detalle: { resultado: 'correo_existente' },
    });
  }
}

export function linkError(motivo: 'invalido' | 'usado' | 'caducado'): AuthError {
  const texto = {
    invalido: 'Este enlace no es válido.',
    usado: 'Este enlace ya se usó.',
    caducado: 'Este enlace caducó.',
  }[motivo];
  return new AuthError(410, `enlace_${motivo}`, `${texto} Pide uno nuevo para continuar.`);
}
