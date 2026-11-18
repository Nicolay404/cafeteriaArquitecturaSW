import { isIPv4, isIPv6 } from 'node:net';

// FR-016 / research D-15: eventos de seguridad de solo inserción, SIN contraseñas, tokens, códigos
// ni datos personales. La IP se trunca (/24 en IPv4, /48 en IPv6) y el detalle se sanea: cualquier
// clave que parezca un secreto se descarta antes de guardar, aunque un llamador la envíe por error.

export const SECURITY_EVENT_TYPES = [
  'registro',
  'acceso_ok',
  'acceso_fallido',
  'bloqueo',
  'recuperacion',
  'restablecimiento',
  'cambio_rol',
  'mfa_activado',
  'mfa_restablecido',
  'acceso_denegado',
  'cuenta_desactivada',
  'cuenta_reactivada',
  'cuenta_eliminada',
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface SecurityEventInput {
  tipo: SecurityEventType;
  /** Nulo si el intento no corresponde a una cuenta existente (no se revela cuál es). */
  cuentaId?: string | null;
  ip?: string | undefined;
  agente?: string | undefined;
  detalle?: Record<string, string | number | boolean | null>;
}

/** Cliente mínimo de Postgres (pg.Pool o pg.Client), inyectable en pruebas. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const FORBIDDEN_KEY = /contras|passw|secret|token|codigo|code|clave|key|correo|email|nombre|tel/i;

/** Primeros tres grupos de una IPv6 válida, expandiendo «::»; null si no es IPv6. */
function firstGroupsV6(ip: string): string[] | null {
  if (!isIPv6(ip)) return null;
  const [left = '', right = ''] = ip.split('::');
  const head = left === '' ? [] : left.split(':');
  const tail = ip.includes('::') ? (right === '' ? [] : right.split(':')) : [];
  const groups = ip.includes('::')
    ? [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail]
    : head;
  return groups.slice(0, 3).map((group) => group.replace(/^0+(?=.)/, '').toLowerCase());
}

export function truncateIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const value = ip.trim().replace(/^::ffff:/i, '');
  if (isIPv4(value)) return `${value.split('.').slice(0, 3).join('.')}.0/24`;
  const groups = firstGroupsV6(value);
  return groups ? `${groups.join(':')}::/48` : null;
}

/** Resume el agente de usuario a navegador y sistema, sin versión exacta ni identificadores. */
export function summarizeAgent(agent: string | undefined): string | null {
  if (!agent) return null;
  const browser = /(Firefox|Edg|Chrome|Safari|curl)\b/.exec(agent)?.[1] ?? 'otro';
  const system = /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/.exec(agent)?.[1] ?? 'otro';
  return `${browser} / ${system}`;
}

export function sanitizeDetail(
  detail: SecurityEventInput['detalle'],
): Record<string, string | number | boolean | null> {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (FORBIDDEN_KEY.test(key)) continue;
    clean[key] = typeof value === 'string' ? value.slice(0, 120) : value;
  }
  return clean;
}

export class SecurityEvents {
  constructor(private readonly db: Queryable) {}

  async record(event: SecurityEventInput): Promise<void> {
    await this.db.query(
      `INSERT INTO identity.evento_seguridad (cuenta_id, tipo, ip_truncada, agente, detalle)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.cuentaId ?? null,
        event.tipo,
        truncateIp(event.ip),
        summarizeAgent(event.agente),
        JSON.stringify(sanitizeDetail(event.detalle)),
      ],
    );
  }
}
