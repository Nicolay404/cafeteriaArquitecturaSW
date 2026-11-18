-- Migration 002: Schema for Reports, Analytics and Immutable Audit Log (Spec #8)

CREATE SCHEMA IF NOT EXISTS reports;

-- Proyección analítica de pedidos (almacena datos agregados y disociados sin PII)
CREATE TABLE IF NOT EXISTS reports.order_projection (
  id VARCHAR(64) PRIMARY KEY,
  customer_id VARCHAR(64) NOT NULL,
  payment_method VARCHAR(32) NOT NULL,
  order_status VARCHAR(32) NOT NULL,
  total_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  promotion_id VARCHAR(64),
  holiday_name VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_order_projection_delivered_at ON reports.order_projection(delivered_at);
CREATE INDEX IF NOT EXISTS idx_order_projection_status ON reports.order_projection(order_status);
CREATE INDEX IF NOT EXISTS idx_order_projection_payment_method ON reports.order_projection(payment_method);
CREATE INDEX IF NOT EXISTS idx_order_projection_holiday ON reports.order_projection(holiday_name);

-- Detalle de productos por pedido para analítica de ítems más vendidos
CREATE TABLE IF NOT EXISTS reports.order_item_projection (
  id BIGSERIAL PRIMARY KEY,
  order_id VARCHAR(64) NOT NULL REFERENCES reports.order_projection(id) ON DELETE CASCADE,
  product_id VARCHAR(64) NOT NULL,
  product_name VARCHAR(255) NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_item_product ON reports.order_item_projection(product_id);
CREATE INDEX IF NOT EXISTS idx_order_item_created_at ON reports.order_item_projection(created_at);

-- Registro inmutable de auditoría
CREATE TABLE IF NOT EXISTS reports.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id VARCHAR(64) NOT NULL,
  actor_role VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON reports.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id ON reports.audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON reports.audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON reports.audit_log(action);

-- Trigger de inmutabilidad estricta: previene UPDATE y DELETE en reports.audit_log
CREATE OR REPLACE FUNCTION reports.prevent_audit_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries are immutable and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_audit_modification ON reports.audit_log;
CREATE TRIGGER trg_prevent_audit_modification
BEFORE UPDATE OR DELETE ON reports.audit_log
FOR EACH ROW EXECUTE FUNCTION reports.prevent_audit_modification();

-- Parámetros de configuración operativa en caliente
CREATE TABLE IF NOT EXISTS reports.operational_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_by VARCHAR(64) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valores iniciales para configuración operativa
INSERT INTO reports.operational_config (config_key, config_value, description, updated_by)
VALUES 
  ('payments.cash.max_pending_orders', '2'::jsonb, 'Límite máximo de pedidos en efectivo pendientes por cliente', 'system'),
  ('system.maintenance_mode', 'false'::jsonb, 'Modo de mantenimiento operativo de la cafetería', 'system')
ON CONFLICT (config_key) DO NOTHING;
