import type {
  PaymentMethod,
  PaymentStatus,
  ReceiptStatus,
} from '../../../../../../packages/contracts/src/index.js';

export interface DbClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface PaymentEntity {
  id: string;
  orderId: string;
  customerId: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  externalReference: string | null;
  idempotencyKey: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdempotencyKeyEntity {
  key: string;
  action: string;
  paymentId: string | null;
  responseStatus: number;
  responseBody: unknown;
  expiresAt: string;
}

export interface TransferReceiptEntity {
  id: string;
  paymentId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSizeBytes: number;
  status: ReceiptStatus;
  verifiedBy: string | null;
  rejectionReason: string | null;
  verifiedAt: string | null;
  createdAt: string;
  retentionUntil: string;
}

export interface RefundEntity {
  id: string;
  paymentId: string;
  amountCents: number;
  status: 'pending' | 'completed' | 'failed';
  method: 'card_gateway' | 'manual_transfer' | 'cash_desk';
  externalRefundId: string | null;
  reason: string;
  requestedBy: string;
  createdAt: string;
  completedAt: string | null;
}

export class PaymentRepository {
  constructor(private readonly db: DbClient) {}

  async createPayment(data: {
    orderId: string;
    customerId: string;
    method: PaymentMethod;
    amountCents: number;
    currency?: string;
    idempotencyKey?: string;
  }): Promise<PaymentEntity> {
    const query = `
      INSERT INTO payments.payment (
        order_id, customer_id, method, status, amount_cents, currency, idempotency_key
      ) VALUES ($1, $2, $3, 'pending', $4, $5, $6)
      RETURNING
        id, order_id AS "orderId", customer_id AS "customerId", method,
        status, amount_cents AS "amountCents", currency,
        external_reference AS "externalReference", idempotency_key AS "idempotencyKey",
        failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    const res = await this.db.query<PaymentEntity>(query, [
      data.orderId,
      data.customerId,
      data.method,
      data.amountCents,
      data.currency ?? 'USD',
      data.idempotencyKey ?? null,
    ]);
    return res.rows[0]!;
  }

  async findPaymentById(id: string): Promise<PaymentEntity | null> {
    const query = `
      SELECT
        id, order_id AS "orderId", customer_id AS "customerId", method,
        status, amount_cents AS "amountCents", currency,
        external_reference AS "externalReference", idempotency_key AS "idempotencyKey",
        failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM payments.payment
      WHERE id = $1
    `;
    const res = await this.db.query<PaymentEntity>(query, [id]);
    return res.rows[0] ?? null;
  }

  async findPaymentByOrderId(orderId: string): Promise<PaymentEntity | null> {
    const query = `
      SELECT
        id, order_id AS "orderId", customer_id AS "customerId", method,
        status, amount_cents AS "amountCents", currency,
        external_reference AS "externalReference", idempotency_key AS "idempotencyKey",
        failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM payments.payment
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const res = await this.db.query<PaymentEntity>(query, [orderId]);
    return res.rows[0] ?? null;
  }

  async updatePaymentStatus(
    id: string,
    currentStatus: PaymentStatus,
    newStatus: PaymentStatus,
    options: {
      externalReference?: string | null;
      failureReason?: string | null;
    } = {},
  ): Promise<PaymentEntity | null> {
    const query = `
      UPDATE payments.payment
      SET
        status = $1,
        external_reference = COALESCE($2, external_reference),
        failure_reason = COALESCE($3, failure_reason),
        updated_at = now()
      WHERE id = $4 AND status = $5
      RETURNING
        id, order_id AS "orderId", customer_id AS "customerId", method,
        status, amount_cents AS "amountCents", currency,
        external_reference AS "externalReference", idempotency_key AS "idempotencyKey",
        failure_reason AS "failureReason", created_at AS "createdAt", updated_at AS "updatedAt"
    `;
    const res = await this.db.query<PaymentEntity>(query, [
      newStatus,
      options.externalReference ?? null,
      options.failureReason ?? null,
      id,
      currentStatus,
    ]);
    return res.rows[0] ?? null;
  }

  async countPendingCashOrdersByCustomer(customerId: string): Promise<number> {
    const query = `
      SELECT COUNT(*)::int AS count
      FROM payments.payment
      WHERE customer_id = $1 AND method = 'cash' AND status = 'pending'
    `;
    const res = await this.db.query<{ count: number }>(query, [customerId]);
    return res.rows[0]?.count ?? 0;
  }

  async saveIdempotencyKey(data: {
    key: string;
    action: string;
    paymentId?: string | null;
    responseStatus: number;
    responseBody: unknown;
    ttlHours?: number;
  }): Promise<void> {
    const ttlHours = data.ttlHours ?? 24;
    const query = `
      INSERT INTO payments.idempotency_key (
        key, action, payment_id, response_status, response_body, expires_at
      ) VALUES ($1, $2, $3, $4, $5, now() + ($6 || ' hours')::interval)
      ON CONFLICT (key) DO NOTHING
    `;
    await this.db.query(query, [
      data.key,
      data.action,
      data.paymentId ?? null,
      data.responseStatus,
      JSON.stringify(data.responseBody),
      ttlHours,
    ]);
  }

  async getIdempotencyKey(key: string): Promise<IdempotencyKeyEntity | null> {
    const query = `
      SELECT
        key, action, payment_id AS "paymentId",
        response_status AS "responseStatus", response_body AS "responseBody",
        expires_at AS "expiresAt"
      FROM payments.idempotency_key
      WHERE key = $1 AND expires_at > now()
    `;
    const res = await this.db.query<IdempotencyKeyEntity>(query, [key]);
    return res.rows[0] ?? null;
  }

  async saveTransferReceipt(data: {
    paymentId: string;
    fileName: string;
    originalName: string;
    mimeType: string;
    fileSizeBytes: number;
  }): Promise<TransferReceiptEntity> {
    const query = `
      INSERT INTO payments.transfer_receipt (
        payment_id, file_name, original_name, mime_type, file_size_bytes
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id, payment_id AS "paymentId", file_name AS "fileName",
        original_name AS "originalName", mime_type AS "mimeType",
        file_size_bytes AS "fileSizeBytes", status,
        verified_by AS "verifiedBy", rejection_reason AS "rejectionReason",
        verified_at AS "verifiedAt", created_at AS "createdAt",
        retention_until AS "retentionUntil"
    `;
    const res = await this.db.query<TransferReceiptEntity>(query, [
      data.paymentId,
      data.fileName,
      data.originalName,
      data.mimeType,
      data.fileSizeBytes,
    ]);
    return res.rows[0]!;
  }

  async findTransferReceiptByPaymentId(paymentId: string): Promise<TransferReceiptEntity | null> {
    const query = `
      SELECT
        id, payment_id AS "paymentId", file_name AS "fileName",
        original_name AS "originalName", mime_type AS "mimeType",
        file_size_bytes AS "fileSizeBytes", status,
        verified_by AS "verifiedBy", rejection_reason AS "rejectionReason",
        verified_at AS "verifiedAt", created_at AS "createdAt",
        retention_until AS "retentionUntil"
      FROM payments.transfer_receipt
      WHERE payment_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const res = await this.db.query<TransferReceiptEntity>(query, [paymentId]);
    return res.rows[0] ?? null;
  }

  async updateTransferReceiptStatus(
    receiptId: string,
    status: 'verified' | 'rejected',
    verifiedBy: string,
    rejectionReason?: string,
  ): Promise<TransferReceiptEntity | null> {
    const query = `
      UPDATE payments.transfer_receipt
      SET
        status = $1,
        verified_by = $2,
        rejection_reason = $3,
        verified_at = now()
      WHERE id = $4
      RETURNING
        id, payment_id AS "paymentId", file_name AS "fileName",
        original_name AS "originalName", mime_type AS "mimeType",
        file_size_bytes AS "fileSizeBytes", status,
        verified_by AS "verifiedBy", rejection_reason AS "rejectionReason",
        verified_at AS "verifiedAt", created_at AS "createdAt",
        retention_until AS "retentionUntil"
    `;
    const res = await this.db.query<TransferReceiptEntity>(query, [
      status,
      verifiedBy,
      rejectionReason ?? null,
      receiptId,
    ]);
    return res.rows[0] ?? null;
  }

  async createRefund(data: {
    paymentId: string;
    amountCents: number;
    method: 'card_gateway' | 'manual_transfer' | 'cash_desk';
    reason: string;
    requestedBy: string;
    externalRefundId?: string | null;
    status?: 'pending' | 'completed' | 'failed';
  }): Promise<RefundEntity> {
    const query = `
      INSERT INTO payments.refund (
        payment_id, amount_cents, method, reason, requested_by,
        external_refund_id, status, completed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $7 = 'completed' THEN now() ELSE NULL END
      )
      RETURNING
        id, payment_id AS "paymentId", amount_cents AS "amountCents",
        status, method, external_refund_id AS "externalRefundId",
        reason, requested_by AS "requestedBy", created_at AS "createdAt",
        completed_at AS "completedAt"
    `;
    const res = await this.db.query<RefundEntity>(query, [
      data.paymentId,
      data.amountCents,
      data.method,
      data.reason,
      data.requestedBy,
      data.externalRefundId ?? null,
      data.status ?? 'pending',
    ]);
    return res.rows[0]!;
  }

  async recordAuditLog(data: {
    paymentId: string;
    action: string;
    actorId: string;
    actorRole: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const query = `
      INSERT INTO payments.audit_log (
        payment_id, action, actor_id, actor_role, metadata
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    await this.db.query(query, [
      data.paymentId,
      data.action,
      data.actorId,
      data.actorRole,
      JSON.stringify(data.metadata ?? {}),
    ]);
  }
}
