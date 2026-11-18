-- Spec #2 — esquema `customers` (módulo Clientes), único lugar donde vive la PII (constitución III).
-- Migración EXPANSIVA: solo objetos nuevos. Toda columna con datos personales termina en
-- `_cifrado` (AES-256-GCM por columna, formato v<clave>:<iv>:<texto>:<etiqueta>); nunca en claro.
CREATE SCHEMA IF NOT EXISTS customers;

CREATE TABLE customers.persona (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_cifrado text NOT NULL,
  correo_cifrado text NOT NULL,
  telefono_cifrado text,
  preferencias_cifradas text,
  -- Marca de la eliminación LOPDP: tras ella, las columnas cifradas son marcadores anónimos.
  eliminada_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now()
);

-- Un registro por cambio: el historial prueba cuándo se dio o se retiró cada consentimiento.
CREATE TABLE customers.consentimiento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL REFERENCES customers.persona (id) ON DELETE CASCADE,
  finalidad text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('otorgado', 'retirado')),
  version_politica text NOT NULL,
  cambiado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consentimiento_vigente ON customers.consentimiento (persona_id, finalidad, cambiado_en DESC);

-- Sobrevive a la eliminación y por eso NO lleva PII ni clave foránea a `persona`.
CREATE TABLE customers.solicitud_derechos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_ref uuid NOT NULL,
  tipo text NOT NULL CHECK (
    tipo IN ('acceso', 'rectificacion', 'eliminacion', 'oposicion', 'portabilidad')
  ),
  estado text NOT NULL DEFAULT 'recibida' CHECK (
    estado IN ('recibida', 'en_curso', 'pendiente_de_pedidos', 'completada')
  ),
  solicitada_en timestamptz NOT NULL DEFAULT now(),
  completada_en timestamptz,
  -- Plazo legal de 15 días desde la solicitud.
  vence_en timestamptz NOT NULL DEFAULT (now() + interval '15 days'),
  CONSTRAINT completada_con_fecha CHECK ((estado = 'completada') = (completada_en IS NOT NULL))
);
CREATE INDEX solicitud_derechos_persona ON customers.solicitud_derechos (persona_ref, tipo);

CREATE TABLE customers.outbox_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  carga jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  publicado_en timestamptz
);
CREATE INDEX outbox_clientes_pendientes ON customers.outbox_clientes (creado_en)
  WHERE publicado_en IS NULL;
