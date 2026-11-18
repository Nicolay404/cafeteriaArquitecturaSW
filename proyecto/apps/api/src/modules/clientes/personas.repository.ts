import type { Db } from '../../../../../packages/contracts/src/db.js';
import { PiiCipher } from './pii-cipher.js';
import type { ContactoDeCuenta } from './ports.js';

// T018 — la persona (nombre, correo, teléfono) vive SOLO aquí y siempre cifrada por columna
// (constitución III). Identidad solo conoce el id y el índice ciego del correo. Esta clase es la
// implementación interna; el resto de módulos usa la interfaz pública `ContactoDeCuenta`.

export const POLITICA_VERSION = '2026-11';
const NOMBRE = 'persona.nombre';
const CORREO = 'persona.correo';

export class PersonasRepository implements ContactoDeCuenta {
  constructor(
    private readonly db: Db,
    private readonly cipher: PiiCipher,
  ) {}

  /**
   * Crea la persona y deja constancia de que aceptó la política de privacidad (FR-001). Recibe la
   * transacción de quien llama para no dejar PII huérfana si falla la cuenta.
   */
  async crear(input: { nombre: string; correo: string }, tx: Db = this.db): Promise<string> {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO customers.persona (nombre_cifrado, correo_cifrado)
       VALUES ($1, $2) RETURNING id`,
      [this.cipher.encrypt(input.nombre, NOMBRE), this.cipher.encrypt(input.correo, CORREO)],
    );
    const id = rows[0]!.id;
    await tx.query(
      `INSERT INTO customers.consentimiento (persona_id, finalidad, estado, version_politica)
       VALUES ($1, 'politica_privacidad', 'otorgado', $2)`,
      [id, POLITICA_VERSION],
    );
    return id;
  }

  async contactoDe(personaId: string): Promise<{ nombre: string; correo: string } | null> {
    const { rows } = await this.db.query<{ nombre_cifrado: string; correo_cifrado: string }>(
      `SELECT nombre_cifrado, correo_cifrado FROM customers.persona
        WHERE id = $1 AND eliminada_en IS NULL`,
      [personaId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      nombre: this.cipher.decrypt(row.nombre_cifrado, NOMBRE),
      correo: this.cipher.decrypt(row.correo_cifrado, CORREO),
    };
  }
}
