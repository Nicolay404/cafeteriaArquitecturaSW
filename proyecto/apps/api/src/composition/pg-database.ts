import type { Pool } from 'pg';
import type { Db, TransactionalDb } from '../../../../packages/contracts/src/db.js';

/** Adaptador de `pg.Pool` al contrato `TransactionalDb`. Vive en la raíz de composición. */
export class PgDatabase implements TransactionalDb {
  constructor(private readonly pool: Pool) {}

  query<T = unknown>(text: string, values?: unknown[]) {
    return this.pool.query(text, values) as unknown as Promise<{
      rows: T[];
      rowCount: number | null;
    }>;
  }

  async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work({
        query: <R>(text: string, values?: unknown[]) =>
          client.query(text, values) as unknown as Promise<{ rows: R[]; rowCount: number | null }>,
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
