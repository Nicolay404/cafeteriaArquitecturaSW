// Heurística para que un manifiesto o una configuración nunca lleven secretos dentro
// (data-model.md: «sin secretos dentro»). No sustituye a Gitleaks: es una barrera adicional en el
// punto donde se construyen los contratos que viajan entre entornos.
const PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /sk_(live|test)_[A-Za-z0-9]{16,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // Cualquier URL con usuario y contraseña incrustados.
  /[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i,
];

export function containsSecret(value: string): boolean {
  return PATTERNS.some((pattern) => pattern.test(value));
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Rechaza cualquier campo que no pertenezca al contrato. */
export function assertKnownFields(input: Record<string, unknown>, allowed: readonly string[]) {
  for (const key of Object.keys(input))
    if (!allowed.includes(key)) throw new Error(`Campo no permitido en el contrato: ${key}`);
}
