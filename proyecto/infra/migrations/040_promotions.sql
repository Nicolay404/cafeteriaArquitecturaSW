-- Spec #5 Promociones (bloque 040–049, ver infra/migrations/README.md). Solo esquema propio,
-- solo aditiva (expand). Sin PII: los IDs de producto, categoría y menú son identificadores
-- públicos de Catálogo, y el actor es el identificador público de Identidad.
-- Modelo: specs/005-promociones-descuentos/data-model.md.
CREATE SCHEMA IF NOT EXISTS promotions;

CREATE TABLE promotions.promotions (
  id uuid PRIMARY KEY,
  nombre text NOT NULL CHECK (char_length(nombre) BETWEEN 3 AND 80),
  tipo text NOT NULL CHECK (tipo IN ('porcentaje', 'monto_fijo', 'nxm', 'combo')),
  valor jsonb NOT NULL,
  alcance jsonb NOT NULL,
  inicio timestamptz NOT NULL,
  fin timestamptz NOT NULL,
  etiqueta_festividad text NULL CHECK (char_length(etiqueta_festividad) BETWEEN 1 AND 40),
  prioridad integer NOT NULL DEFAULT 0 CHECK (prioridad BETWEEN 0 AND 1000),
  acumulable boolean NOT NULL DEFAULT false,
  monto_minimo_centavos bigint NULL CHECK (monto_minimo_centavos >= 0),
  cupon_codigo text NULL CHECK (cupon_codigo ~ '^[A-Z0-9-]{4,32}$'),
  cupon_limite_usos integer NULL CHECK (cupon_limite_usos >= 1),
  usos integer NOT NULL DEFAULT 0 CHECK (usos >= 0),
  estado text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'pausada', 'archivada')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  creada_por text NOT NULL,
  actualizada_por text NOT NULL,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promotions_ventana CHECK (fin > inicio),
  CONSTRAINT promotions_limite_requiere_cupon CHECK (cupon_limite_usos IS NULL OR cupon_codigo IS NOT NULL),
  CONSTRAINT promotions_usos_dentro_del_limite CHECK (cupon_limite_usos IS NULL OR usos <= cupon_limite_usos)
);

-- Un código de cupón no se repite entre promociones no archivadas.
CREATE UNIQUE INDEX promotions_cupon_unico ON promotions.promotions (cupon_codigo)
  WHERE cupon_codigo IS NOT NULL AND estado <> 'archivada';

-- Carga de candidatas: activas cuya ventana no ha terminado.
CREATE INDEX promotions_activas_por_fin ON promotions.promotions (fin) WHERE estado = 'activa';

-- Usos de cupón consumidos por pedido (spec 006): idempotencia por (promoción, pedido).
CREATE TABLE promotions.coupon_redemptions (
  promocion_id uuid NOT NULL REFERENCES promotions.promotions (id),
  pedido_id text NOT NULL CHECK (char_length(pedido_id) BETWEEN 1 AND 100),
  creado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promocion_id, pedido_id)
);
CREATE INDEX coupon_redemptions_por_pedido ON promotions.coupon_redemptions (pedido_id);

-- Auditoría de cambios en promociones (FR-014): solo inserción.
CREATE TABLE promotions.promotion_changes (
  id bigserial PRIMARY KEY,
  promocion_id uuid NOT NULL REFERENCES promotions.promotions (id),
  actor_id text NOT NULL,
  accion text NOT NULL CHECK (accion IN ('crear', 'editar', 'pausar', 'reanudar', 'archivar')),
  antes jsonb NULL,
  despues jsonb NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX promotion_changes_por_promocion ON promotions.promotion_changes (promocion_id, id);

CREATE FUNCTION promotions.auditoria_inmutable() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría de promociones es inmutable: no se modifica ni se borra';
END;
$$;

CREATE TRIGGER promotion_changes_inmutable
  BEFORE UPDATE OR DELETE ON promotions.promotion_changes
  FOR EACH ROW EXECUTE FUNCTION promotions.auditoria_inmutable();
