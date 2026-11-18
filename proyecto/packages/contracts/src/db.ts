/**
 * Cliente mínimo de Postgres que usan los módulos (lo cumple `pg.Pool`). Es un contrato de tipos,
 * sin dependencia de `pg`: así los módulos de dominio no importan nada técnico y las pruebas
 * pueden inyectar una base real o un doble.
 */
export interface Db {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/** `Db` con transacciones: lo hecho dentro de `transaction` se confirma o se deshace entero. */
export interface TransactionalDb extends Db {
  transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
}
