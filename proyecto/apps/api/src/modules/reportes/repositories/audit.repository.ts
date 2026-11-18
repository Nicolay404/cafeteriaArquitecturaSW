import type {
  AuditLogEntryDto,
  AuditQueryDto,
  CreateAuditEntryDto,
  OperationalConfigDto,
} from '../../../../../../packages/contracts/src/index.js';
import type { DbClient } from './reports.repository.js';

export class AuditRepository {
  constructor(private readonly db: DbClient) {}

  async recordAuditLog(entry: CreateAuditEntryDto): Promise<string> {
    const query = `
      INSERT INTO reports.audit_log (
        actor_id, actor_role, action, entity_type, entity_id, before_state, after_state, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;
    const res = await this.db.query<{ id: string }>(query, [
      entry.actorId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.beforeState ? JSON.stringify(entry.beforeState) : null,
      entry.afterState ? JSON.stringify(entry.afterState) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ]);
    return res.rows[0]?.id ?? '';
  }

  async queryAuditLogs(
    filters: AuditQueryDto,
  ): Promise<{ entries: AuditLogEntryDto[]; totalCount: number }> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.from) {
      conditions.push(`timestamp >= $${idx++}`);
      values.push(`${filters.from}T00:00:00.000Z`);
    }
    if (filters.to) {
      conditions.push(`timestamp <= $${idx++}`);
      values.push(`${filters.to}T23:59:59.999Z`);
    }
    if (filters.actorId) {
      conditions.push(`actor_id = $${idx++}`);
      values.push(filters.actorId);
    }
    if (filters.entityType) {
      conditions.push(`entity_type = $${idx++}`);
      values.push(filters.entityType);
    }
    if (filters.action) {
      conditions.push(`action = $${idx++}`);
      values.push(filters.action);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `SELECT COUNT(*)::INT AS "total" FROM reports.audit_log ${whereClause}`;
    const countRes = await this.db.query<{ total: number }>(countQuery, values);
    const totalCount = countRes.rows[0]?.total ?? 0;

    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const dataQuery = `
      SELECT
        id,
        timestamp,
        actor_id AS "actorId",
        actor_role AS "actorRole",
        action,
        entity_type AS "entityType",
        entity_id AS "entityId",
        before_state AS "beforeState",
        after_state AS "afterState",
        metadata
      FROM reports.audit_log
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `;
    values.push(limit, offset);

    const dataRes = await this.db.query<AuditLogEntryDto>(dataQuery, values);
    return {
      entries: dataRes.rows,
      totalCount,
    };
  }

  async getOperationalConfig(): Promise<OperationalConfigDto[]> {
    const query = `
      SELECT
        config_key AS "configKey",
        config_value AS "configValue",
        description,
        updated_by AS "updatedBy",
        updated_at AS "updatedAt"
      FROM reports.operational_config
      ORDER BY config_key ASC
    `;
    const res = await this.db.query<OperationalConfigDto>(query);
    return res.rows;
  }

  async getOperationalConfigByKey(key: string): Promise<OperationalConfigDto | null> {
    const query = `
      SELECT
        config_key AS "configKey",
        config_value AS "configValue",
        description,
        updated_by AS "updatedBy",
        updated_at AS "updatedAt"
      FROM reports.operational_config
      WHERE config_key = $1
    `;
    const res = await this.db.query<OperationalConfigDto>(query, [key]);
    return res.rows[0] ?? null;
  }

  async updateOperationalConfig(
    key: string,
    value: unknown,
    description: string,
    updatedBy: string,
  ): Promise<OperationalConfigDto> {
    const query = `
      INSERT INTO reports.operational_config (config_key, config_value, description, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, now())
      ON CONFLICT (config_key) DO UPDATE SET
        config_value = EXCLUDED.config_value,
        description = EXCLUDED.description,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING
        config_key AS "configKey",
        config_value AS "configValue",
        description,
        updated_by AS "updatedBy",
        updated_at AS "updatedAt"
    `;
    const res = await this.db.query<OperationalConfigDto>(query, [
      key,
      JSON.stringify(value),
      description,
      updatedBy,
    ]);
    return res.rows[0]!;
  }
}
