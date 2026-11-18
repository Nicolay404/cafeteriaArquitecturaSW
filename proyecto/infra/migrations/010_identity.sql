-- Spec #2 — esquema `identity` (módulo Identidad). Migración EXPANSIVA: solo crea objetos nuevos,
-- así que la versión anterior de la aplicación sigue funcionando sin tocarlos (N−1).
-- Sin PII en claro: el correo solo existe como índice ciego (HMAC) y la persona se enlaza por
-- `persona_id`, cuyo dueño es el módulo Clientes (esquema `customers`).
CREATE SCHEMA IF NOT EXISTS identity;

CREATE TABLE identity.cuenta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id uuid NOT NULL UNIQUE,
  indice_correo text NOT NULL UNIQUE,
  -- Nulo mientras una invitación de personal no define su contraseña.
  hash_contrasena text,
  rol text NOT NULL CHECK (rol IN ('cliente', 'personal', 'admin')),
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'activa', 'desactivada')),
  correo_confirmado_en timestamptz,
  creada_en timestamptz NOT NULL DEFAULT now(),
  actualizada_en timestamptz NOT NULL DEFAULT now(),
  -- Una cuenta activa siempre tiene el correo confirmado.
  CONSTRAINT cuenta_activa_confirmada CHECK (estado <> 'activa' OR correo_confirmado_en IS NOT NULL)
);

CREATE TABLE identity.segundo_factor (
  cuenta_id uuid PRIMARY KEY REFERENCES identity.cuenta (id) ON DELETE CASCADE,
  secreto_cifrado text NOT NULL,
  activado_en timestamptz,
  -- Último paso TOTP aceptado: cada código vale una sola vez.
  ultimo_paso_usado bigint
);

CREATE TABLE identity.codigo_recuperacion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id uuid NOT NULL REFERENCES identity.cuenta (id) ON DELETE CASCADE,
  hash text NOT NULL,
  usado_en timestamptz
);
CREATE INDEX codigo_recuperacion_cuenta ON identity.codigo_recuperacion (cuenta_id);

CREATE TABLE identity.token_un_uso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id uuid NOT NULL REFERENCES identity.cuenta (id) ON DELETE CASCADE,
  proposito text NOT NULL CHECK (
    proposito IN ('confirmar_correo', 'recuperar', 'invitacion', 'cambio_correo')
  ),
  -- Solo el hash SHA-256 del token: quien lea la tabla no puede canjearlo.
  hash text NOT NULL UNIQUE,
  caduca_en timestamptz NOT NULL,
  usado_en timestamptz
);
CREATE INDEX token_un_uso_cuenta ON identity.token_un_uso (cuenta_id, proposito);

-- Solo inserción: ningún flujo actualiza ni borra eventos. `cuenta_id` es nulo cuando el intento
-- no corresponde a una cuenta existente, para no revelarlo. Sin contraseñas, tokens ni códigos.
CREATE TABLE identity.evento_seguridad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id uuid,
  tipo text NOT NULL CHECK (
    tipo IN (
      'registro', 'acceso_ok', 'acceso_fallido', 'bloqueo', 'recuperacion',
      'restablecimiento', 'cambio_rol', 'mfa_activado', 'mfa_restablecido',
      'acceso_denegado', 'cuenta_desactivada', 'cuenta_reactivada', 'cuenta_eliminada'
    )
  ),
  ip_truncada text,
  agente text,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evento_seguridad_cuenta ON identity.evento_seguridad (cuenta_id, creado_en DESC);

CREATE OR REPLACE FUNCTION identity.evento_seguridad_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity.evento_seguridad es de solo inserción';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evento_seguridad_inmutable
  BEFORE UPDATE OR DELETE ON identity.evento_seguridad
  FOR EACH ROW EXECUTE FUNCTION identity.evento_seguridad_solo_insercion();

CREATE TABLE identity.outbox_identidad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL,
  carga jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),
  publicado_en timestamptz
);
CREATE INDEX outbox_identidad_pendientes ON identity.outbox_identidad (creado_en)
  WHERE publicado_en IS NULL;
