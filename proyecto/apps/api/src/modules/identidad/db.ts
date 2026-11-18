/**
 * Cliente mínimo de Postgres que usan los servicios de Identidad y Clientes (lo cumple `pg.Pool`).
 * Inyectarlo en vez de importar `pg` permite probar con una base real o con un doble.
 */
export interface Db {
  query<T = unknown>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
