import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../../../../../packages/contracts/src/db.js';

// Research D-06: enlaces de un solo uso (confirmar correo, recuperar contraseña, invitación y
// cambio de correo). El token son 256 bits aleatorios en base64url; en la base solo se guarda su
// SHA-256, así que quien lea la tabla no puede canjearlo. El canje es UN solo UPDATE condicionado,
// por lo que dos peticiones simultáneas con el mismo enlace nunca lo usan las dos.

export type TokenPurpose = 'confirmar_correo' | 'recuperar' | 'invitacion' | 'cambio_correo';

/** Vigencia en segundos: la recuperación caduca en 30 minutos (FR-003). */
export const TOKEN_TTL_SECONDS: Record<TokenPurpose, number> = {
  confirmar_correo: 24 * 3600,
  recuperar: 30 * 60,
  invitacion: 72 * 3600,
  cambio_correo: 24 * 3600,
};

export type RedeemResult =
  { ok: true; cuentaId: string } | { ok: false; motivo: 'invalido' | 'usado' | 'caducado' };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export class OneTimeTokens {
  constructor(private readonly db: Db) {}

  /**
   * Crea un token nuevo e invalida los anteriores sin usar de la misma cuenta y finalidad,
   * todo en una sola sentencia (atómico, sin transacción explícita).
   */
  async issue(cuentaId: string, purpose: TokenPurpose, ttlSeconds?: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await this.db.query(
      `WITH anteriores AS (
         UPDATE identity.token_un_uso SET usado_en = now()
          WHERE cuenta_id = $1 AND proposito = $2 AND usado_en IS NULL
       )
       INSERT INTO identity.token_un_uso (cuenta_id, proposito, hash, caduca_en)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::double precision))`,
      [cuentaId, purpose, hashToken(token), ttlSeconds ?? TOKEN_TTL_SECONDS[purpose]],
    );
    return token;
  }

  /** Canjea el token: solo una vez, solo para su finalidad y mientras no haya caducado. */
  async redeem(token: string, purpose: TokenPurpose): Promise<RedeemResult> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false, motivo: 'invalido' };
    const hash = hashToken(token);
    const redeemed = await this.db.query<{ cuenta_id: string }>(
      `UPDATE identity.token_un_uso SET usado_en = now()
        WHERE hash = $1 AND proposito = $2 AND usado_en IS NULL AND caduca_en > now()
        RETURNING cuenta_id`,
      [hash, purpose],
    );
    if (redeemed.rows[0]) return { ok: true, cuentaId: redeemed.rows[0].cuenta_id };

    // No se pudo canjear: se distingue el motivo para decirle a la persona qué hacer (reenviar).
    const found = await this.db.query<{ usado_en: Date | null; caduca_en: Date }>(
      'SELECT usado_en, caduca_en FROM identity.token_un_uso WHERE hash = $1 AND proposito = $2',
      [hash, purpose],
    );
    const row = found.rows[0];
    if (!row) return { ok: false, motivo: 'invalido' };
    return { ok: false, motivo: row.usado_en ? 'usado' : 'caducado' };
  }
}
