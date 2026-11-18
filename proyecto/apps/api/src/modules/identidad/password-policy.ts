import { createHash } from 'node:crypto';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../../../../packages/contracts/src/identidad.js';

// FR-004, research D-04/D-05: la política exige longitud (12–128 caracteres tras NFKC), no reglas de
// composición (NIST 800-63B), y rechaza contraseñas comunes, derivadas de datos de la persona o
// filtradas en brechas. La comprobación de brechas es un puerto: el adaptador HIBP usa
// k-anonimato (solo viajan 5 caracteres del SHA-1) y, si no responde, el registro NO se bloquea:
// se acepta lo que pasó la lista local y se declara que la comprobación se omitió.

export type PasswordRejection = 'corta' | 'larga' | 'comun' | 'personal' | 'filtrada';
export type PasswordVerdict =
  { ok: true; brechas: 'comprobada' | 'omitida' } | { ok: false; motivo: PasswordRejection };

export interface PersonalData {
  correo?: string;
  nombre?: string;
}

export interface BreachChecker {
  isBreached(password: string): Promise<boolean>;
}

// Bases frecuentes en español e inglés. Una contraseña cuyo resto, tras quitarlas y quitar los
// números, mide 3 caracteres o menos es predecible («Password1234», «cafeteria2026»). Dentro de
// una frase larga una base no la invalida.
const COMMON_BASES = [
  'password',
  'passw0rd',
  'contrasena',
  'clave',
  'secreto',
  'admin',
  'administrador',
  'administrator',
  'root',
  'usuario',
  'user',
  'cafeteria',
  'cafe',
  'cliente',
  'bienvenido',
  'bienvenida',
  'welcome',
  'letmein',
  'iloveyou',
  'tequiero',
  'teamo',
  'qwertyuiop',
  'qwerty',
  'qwertz',
  'asdfghjkl',
  'asdfgh',
  'zxcvbnm',
  'abcdefghijklmnopqrstuvwxyz',
  'abcdef',
  'abc',
  'monkey',
  'dragon',
  'master',
  'login',
  'ecuador',
  'quito',
  'guayaquil',
  'cuenca',
  'futbol',
  'football',
  'barcelona',
  'madrid',
  'america',
  'princess',
  'superman',
  'batman',
  'shadow',
  'sunshine',
  'trustno',
  'changeme',
  'default',
  'test',
  'prueba',
  'hola',
  'holamundo',
  'mipassword',
  'micontrasena',
  'mypassword',
  'nombre',
  'unodostres',
  'chocolate',
  'estrella',
  'corazon',
  'amor',
];

const SEQUENCES = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '0123456789'];

const LEET: Record<string, string> = {
  '@': 'a',
  '4': 'a',
  '0': 'o',
  '3': 'e',
  '1': 'i',
  '!': 'i',
  $: 's',
  '5': 's',
  '7': 't',
};

/** Minúsculas, sin acentos y solo letras y números: la forma en que se comparan las listas. */
const flatten = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Sustituciones tipo «leet» solo cuando tocan una letra: «p@ssw0rd» sí, el «1234» final no. */
const deLeet = (value: string) => {
  const text = value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
  const isLetter = (char: string | undefined) => char !== undefined && /[a-z]/.test(char);
  return text
    .replace(/[@$!0-9]/g, (char, index: number) =>
      isLetter(text[index - 1]) || isLetter(text[index + 1]) ? (LEET[char] ?? char) : char,
    )
    .replace(/[^a-z0-9]/g, '');
};

function removeBases(text: string): string {
  let rest = text;
  // Las más largas primero para que «administrador» no deje «istrador» suelto.
  for (const base of [...COMMON_BASES].sort((a, b) => b.length - a.length))
    rest = rest.split(base).join('');
  return rest;
}

/** Detecta contraseñas predecibles sin red. Devuelve el motivo o `null` si pasan la lista local. */
export function localWeakness(
  password: string,
  personal: PersonalData = {},
): 'comun' | 'personal' | null {
  const plain = flatten(password);
  const leet = deLeet(password);

  if (/^(.)\1+$/u.test(plain)) return 'comun';
  // Una unidad corta repetida entera: «abababababab», «fififififi».
  if (/^(.{1,4})\1+$/u.test(plain)) return 'comun';
  // Un tramo de abecedario, de fila de teclado o de cifras consecutivas.
  if (plain.length >= 6 && SEQUENCES.some((sequence) => sequence.includes(plain))) return 'comun';

  if (plain.length <= 24) {
    for (const form of [plain, leet])
      if (removeBases(form).replace(/[0-9]/g, '').length <= 3) return 'comun';
  }

  const tokens = new Set<string>();
  const local = personal.correo?.split('@')[0];
  if (local) {
    tokens.add(flatten(local));
    for (const part of local.split(/[^\p{L}\p{N}]+/u)) tokens.add(flatten(part));
  }
  for (const part of personal.nombre?.split(/\s+/u) ?? []) tokens.add(flatten(part));
  for (const token of tokens) if (token.length >= 4 && plain.includes(token)) return 'personal';

  return null;
}

export class PasswordPolicy {
  constructor(
    private readonly breaches?: BreachChecker,
    private readonly onBreachCheckUnavailable?: () => void,
  ) {}

  async check(password: string, personal: PersonalData = {}): Promise<PasswordVerdict> {
    const length = [...password.normalize('NFKC')].length;
    if (length < PASSWORD_MIN) return { ok: false, motivo: 'corta' };
    if (length > PASSWORD_MAX) return { ok: false, motivo: 'larga' };

    const weakness = localWeakness(password.normalize('NFKC'), personal);
    if (weakness) return { ok: false, motivo: weakness };

    if (!this.breaches) return { ok: true, brechas: 'omitida' };
    try {
      if (await this.breaches.isBreached(password.normalize('NFKC')))
        return { ok: false, motivo: 'filtrada' };
      return { ok: true, brechas: 'comprobada' };
    } catch {
      // Sin servicio no se bloquea el registro: se acepta lo que pasó la lista local.
      this.onBreachCheckUnavailable?.();
      return { ok: true, brechas: 'omitida' };
    }
  }
}

export interface HibpConfig {
  baseUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/** Have I Been Pwned por k-anonimato: el servicio solo ve los 5 primeros caracteres del SHA-1. */
export class HibpChecker implements BreachChecker {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;

  constructor(config: HibpConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api.pwnedpasswords.com/range/';
    this.timeoutMs = config.timeoutMs ?? 1500;
    this.fetcher = config.fetch ?? fetch;
  }

  async isBreached(password: string): Promise<boolean> {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`${this.baseUrl}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'cafeteria-identidad' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`El servicio de brechas respondió ${response.status}`);
      for (const line of (await response.text()).split(/\r?\n/)) {
        const [hash, count] = line.split(':');
        // Las líneas de relleno llevan cantidad 0 y no cuentan.
        if (hash?.trim() === suffix && Number(count) > 0) return true;
      }
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
