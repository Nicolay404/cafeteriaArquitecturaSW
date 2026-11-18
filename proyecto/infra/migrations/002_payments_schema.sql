-- Esquema payments y tablas para el módulo de pagos (Spec #7)
-- Principio II: ningún dato de tarjeta ni CVV en nuestras bases de datos.
-- Principio III: retención de 90 días en comprobantes de transferencias (retention_until).
-- Principio IV: Outbox transaccional e idempotencia.
-- Principio VI: montos en centavos enteros (amount_cents).

CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  method varchar(20) NOT NULL CHECK (method IN ('card', 'transfer', 'cash')),
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency varchar(3) NOT NULL DEFAULT 'USD',
  external_reference varchar(255),
  idempotency_key varchar(255),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_order ON payments.payment (order_id);
CREATE INDEX IF NOT EXISTS idx_payment_customer ON payments.payment (customer_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payments.payment (status);

CREATE TABLE IF NOT EXISTS payments.idempotency_key (
  key varchar(255) PRIMARY KEY,
  action varchar(50) NOT NULL,
  payment_id uuid REFERENCES payments.payment(id) ON DELETE CASCADE,
  request_hash text,
  response_body jsonb,
  response_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS payments.transfer_receipt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments.payment(id) ON DELETE CASCADE,
  file_name varchar(255) NOT NULL,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  file_size_bytes bigint NOT NULL,
  status varchar(30) NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'verified', 'rejected')),
  verified_by uuid,
  rejection_reason text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL DEFAULT (now() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS idx_receipt_payment ON payments.transfer_receipt (payment_id);
CREATE INDEX IF NOT EXISTS idx_receipt_retention ON payments.transfer_receipt (retention_until);

CREATE TABLE IF NOT EXISTS payments.refund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments.payment(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  method varchar(50) NOT NULL CHECK (method IN ('card_gateway', 'manual_transfer', 'cash_desk')),
  external_refund_id varchar(255),
  reason text NOT NULL,
  requested_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_refund_payment ON payments.refund (payment_id);

CREATE TABLE IF NOT EXISTS payments.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments.payment(id) ON DELETE CASCADE,
  action varchar(50) NOT NULL,
  actor_id uuid NOT NULL,
  actor_role varchar(50) NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_audit ON payments.audit_log (payment_id);

CREATE TABLE IF NOT EXISTS payments.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name varchar(100) NOT NULL,
  aggregate_type varchar(50) NOT NULL DEFAULT 'payment',
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'failed')),
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_payments_outbox_pending ON payments.outbox (status, created_at);
