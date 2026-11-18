-- COMPENSAR: una migración aplicada no se revierte ni se edita; se corrige con otra nueva
-- que conserva todas las filas.
ALTER TABLE platform.probe ALTER COLUMN detail DROP NOT NULL;
