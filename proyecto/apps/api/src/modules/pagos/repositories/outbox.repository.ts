import type { DbClient } from './payment.repository.js';

export interface OutboxEventEntity {
  id: string;
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'published' | 'failed';
  retryCount: number;
  createdAt: string;
  processedAt: string | null;
}

export class OutboxRepository {
  constructor(private readonly db: DbClient) {}

  async saveEvent(
    eventName: string,
    aggregateId: string,
    payload: unknown,
    customClient?: DbClient,
  ): Promise<string> {
    const client = customClient ?? this.db;
    const query = `
      INSERT INTO payments.outbox (
        event_name, aggregate_type, aggregate_id, payload, status
      ) VALUES ($1, 'payment', $2, $3, 'pending')
      RETURNING id
    `;
    const res = await client.query<{ id: string }>(query, [
      eventName,
      aggregateId,
      JSON.stringify(payload),
    ]);
    return res.rows[0]!.id;
  }

  async fetchPendingEvents(limit = 50): Promise<OutboxEventEntity[]> {
    const query = `
      SELECT
        id, event_name AS "eventName", aggregate_type AS "aggregateType",
        aggregate_id AS "aggregateId", payload, status,
        retry_count AS "retryCount", created_at AS "createdAt",
        processed_at AS "processedAt"
      FROM payments.outbox
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
    `;
    const res = await this.db.query<OutboxEventEntity>(query, [limit]);
    return res.rows;
  }

  async markEventPublished(id: string): Promise<void> {
    const query = `
      UPDATE payments.outbox
      SET status = 'published', processed_at = now()
      WHERE id = $1
    `;
    await this.db.query(query, [id]);
  }

  async markEventFailed(id: string): Promise<void> {
    const query = `
      UPDATE payments.outbox
      SET retry_count = retry_count + 1,
          status = CASE WHEN retry_count + 1 >= 5 THEN 'failed' ELSE 'pending' END
      WHERE id = $1
    `;
    await this.db.query(query, [id]);
  }
}
