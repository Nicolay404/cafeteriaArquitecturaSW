import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';

// Constitución III / research D-11: la PII se cifra por columna con AES-256-GCM y solo el módulo
// Clientes la maneja. Formato guardado: `v<clave>:<iv>:<texto>:<etiqueta>` (base64url). Cada valor
// se ata a su columna con datos autenticados adicionales (AAD), así que un valor copiado a otra
// columna no se descifra. La versión de clave permite rotarlas sin perder lo ya cifrado.

const MIN_SECRET = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface PiiCipherConfig {
  /** Secretos por versión; se cifra con la mayor y se descifra con cualquiera. */
  keys: Readonly<Record<number, string>>;
  /** Clave del HMAC del índice ciego; independiente de las de cifrado para poder rotarlas aparte. */
  indexKey: string;
}

function assertSecret(value: string, label: string) {
  if (value.length < MIN_SECRET)
    throw new Error(`${label} debe tener al menos ${MIN_SECRET} caracteres`);
}

const derive = (secret: string, purpose: string) =>
  Buffer.from(hkdfSync('sha256', secret, 'cafeteria-pii', purpose, 32));

export class PiiCipher {
  private readonly keys = new Map<number, Buffer>();
  private readonly current: number;
  private readonly indexKey: Buffer;

  constructor(config: PiiCipherConfig) {
    const versions = Object.keys(config.keys).map(Number);
    if (versions.length === 0) throw new Error('Hace falta al menos una clave de cifrado de PII');
    for (const version of versions) {
      if (!Number.isInteger(version) || version < 1)
        throw new Error('La versión de clave debe ser un entero positivo');
      const secret = config.keys[version]!;
      assertSecret(secret, `La clave de PII v${version}`);
      this.keys.set(version, derive(secret, `cifrado:v${version}`));
    }
    this.current = Math.max(...versions);
    assertSecret(config.indexKey, 'La clave del índice');
    this.indexKey = derive(config.indexKey, 'indice-correo');
  }

  /** Cifra con la clave más reciente; `context` es la columna («persona.correo»). */
  encrypt(plain: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.keys.get(this.current)!, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(`v${this.current}|${context}`));
    const text = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [
      `v${this.current}`,
      iv.toString('base64url'),
      text.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join(':');
  }

  decrypt(sealed: string, context: string): string {
    const parts = sealed.split(':');
    const match = parts.length === 4 ? /^v(\d+)$/.exec(parts[0]!) : null;
    if (!match) throw new Error('Formato de valor cifrado no válido');
    const version = Number(match[1]);
    const key = this.keys.get(version);
    if (!key) throw new Error(`Versión de clave desconocida: v${version}`);
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'base64url'), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(Buffer.from(`v${version}|${context}`));
      decipher.setAuthTag(Buffer.from(parts[3]!, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(parts[2]!, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      // Sin detalle: ni el texto ni la clave viajan en el mensaje.
      throw new Error('No se pudo descifrar el valor');
    }
  }

  /** `true` si el valor está cifrado con una clave anterior y conviene recifrarlo. */
  needsRotation(sealed: string): boolean {
    return !sealed.startsWith(`v${this.current}:`);
  }

  /** HMAC-SHA-256 del correo normalizado: permite buscar por correo sin guardarlo en claro. */
  blindIndex(email: string): string {
    return createHmac('sha256', this.indexKey)
      .update(email.normalize('NFKC').trim().toLowerCase())
      .digest('hex');
  }
}
