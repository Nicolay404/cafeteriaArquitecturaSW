-- Tabla TÉCNICA de la plataforma para ensayar migraciones. Datos sintéticos, sin PII y sin
-- relación con el negocio: no es el modelo de catálogo ni de clientes.
CREATE TABLE platform.probe (
  id bigserial PRIMARY KEY,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
