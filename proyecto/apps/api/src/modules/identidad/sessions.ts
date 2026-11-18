import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from 'redis';
import type { Rol } from '../../../../../packages/contracts/src/identidad.js';

// Research D-01/D-02: sesiones opacas en Redis. El navegador solo guarda un token aleatorio de 256
// bits; en Redis la clave es HMAC(token) con el secreto de sesión, así que quien lea Redis no puede
// reconstruir una cookie. Servicio sin estado (constitución IV): N instancias comparten sesiones.
// Caducidad deslizante por inactividad y absoluta desde la creación. Un índice por cuenta permite
// cortar TODAS sus sesiones al instante (desactivar personal, restablecer contraseña).

export interface Session {
  cuentaId: string;
  rol: Rol;
  /** El segundo factor se verificó en esta sesión (obligatorio para personal y admin). */
  mfaVerificado: boolean;
  /** Epoch ms de la última autenticación con contraseña, para las acciones que piden reautenticar. */
  autenticadoEn: number;
  creadaEn: number;
  csrf: string;
}

export interface CreatedSession {
  /** Valor de la cookie; solo se entrega una vez. */
  token: string;
  session: Session;
}

export class SessionStoreUnavailableError extends Error {
  constructor() {
    super('El almacén de sesiones no está disponible');
    this.name = 'SessionStoreUnavailableError';
  }
}

export interface SessionStoreConfig {
  redisUrl: string;
  prefix: string;
  secret: string;
  /** Caducidad por inactividad; por defecto 8 h. */
  idleSeconds?: number;
  /** Caducidad absoluta desde la creación; por defecto 30 días. */
  absoluteSeconds?: number;
  /** Reloj inyectable para las pruebas. */
  now?: () => number;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TIMEOUT_MS = 1000;

const open = (url: string) =>
  createClient({
    url,
    socket: { connectTimeout: 800, reconnectStrategy: (retries) => Math.min(retries * 100, 500) },
  });
type Client = ReturnType<typeof open>;

export class SessionStore {
  private client: Client | undefined;
  private connecting: Promise<Client> | undefined;
  private readonly idle: number;
  private readonly absolute: number;
  private readonly now: () => number;

  constructor(private readonly config: SessionStoreConfig) {
    if (config.secret.length < 32)
      throw new Error('El secreto de sesión debe tener 32 caracteres o más');
    this.idle = config.idleSeconds ?? 8 * 3600;
    this.absolute = config.absoluteSeconds ?? 30 * 24 * 3600;
    this.now = config.now ?? Date.now;
  }

  async create(input: {
    cuentaId: string;
    rol: Rol;
    mfaVerificado: boolean;
  }): Promise<CreatedSession> {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const session: Session = {
      ...input,
      autenticadoEn: now,
      creadaEn: now,
      csrf: randomBytes(32).toString('base64url'),
    };
    const key = this.keyOf(token);
    const index = this.indexOf(input.cuentaId);
    await this.guard(async (client) => {
      await client
        .multi()
        .set(key, JSON.stringify(session), { EX: this.idle })
        .sAdd(index, key)
        .expire(index, this.absolute)
        .exec();
    });
    return { token, session };
  }

  /** Devuelve la sesión y renueva la inactividad; `null` si no existe, caducó o el token es inválido. */
  async get(token: string | undefined): Promise<Session | null> {
    if (!token || !TOKEN.test(token)) return null;
    const key = this.keyOf(token);
    const raw = await this.guard((client) => client.get(key));
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    const remaining = this.absolute - Math.floor((this.now() - session.creadaEn) / 1000);
    if (remaining <= 0) {
      await this.destroy(token);
      return null;
    }
    await this.guard((client) => client.expire(key, Math.min(this.idle, remaining)));
    return session;
  }

  /** Actualiza campos de la sesión (p. ej. tras verificar el segundo factor o reautenticar). */
  async update(
    token: string,
    patch: Partial<Pick<Session, 'mfaVerificado' | 'autenticadoEn' | 'rol'>>,
  ): Promise<Session | null> {
    const session = await this.get(token);
    if (!session) return null;
    const updated = { ...session, ...patch };
    await this.guard((client) =>
      client.set(this.keyOf(token), JSON.stringify(updated), { XX: true, KEEPTTL: true }),
    );
    return updated;
  }

  async destroy(token: string | undefined): Promise<void> {
    if (!token || !TOKEN.test(token)) return;
    await this.guard((client) => client.del(this.keyOf(token)));
  }

  /** Corta todas las sesiones de una cuenta; `except` conserva la actual (cambio de contraseña). */
  async destroyAll(cuentaId: string, except?: string): Promise<number> {
    const index = this.indexOf(cuentaId);
    const keep = except && TOKEN.test(except) ? this.keyOf(except) : undefined;
    return this.guard(async (client) => {
      const keys = (await client.sMembers(index)).filter((key) => key !== keep);
      if (keys.length > 0) {
        await client.del(keys);
        await client.sRem(index, keys);
      }
      return keys.length;
    });
  }

  /** Compara el token CSRF de la cabecera con el de la sesión en tiempo constante. */
  verifyCsrf(session: Session, header: string | undefined): boolean {
    if (!header) return false;
    const expected = Buffer.from(session.csrf);
    const received = Buffer.from(header);
    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    client?.destroy();
  }

  private keyOf(token: string) {
    const digest = createHmac('sha256', this.config.secret).update(token).digest('hex');
    return `${this.config.prefix}:sesion:${digest}`;
  }

  private indexOf(cuentaId: string) {
    return `${this.config.prefix}:sesiones:${cuentaId}`;
  }

  private async connect(): Promise<Client> {
    if (this.client?.isReady) return this.client;
    this.connecting ??= (async () => {
      const client = open(this.config.redisUrl);
      client.on('error', () => {});
      await client.connect();
      this.client = client;
      return client;
    })();
    try {
      return await this.connecting;
    } catch (error) {
      this.connecting = undefined;
      throw error;
    }
  }

  private async guard<T>(operation: (client: Client) => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.connect().then(operation),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new SessionStoreUnavailableError()), TIMEOUT_MS);
        }),
      ]);
    } catch {
      throw new SessionStoreUnavailableError();
    } finally {
      clearTimeout(timer);
    }
  }
}
