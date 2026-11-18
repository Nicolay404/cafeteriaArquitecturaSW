-- CONTRAER: solo es seguro cuando ya no corre la versión N−1, porque esta no escribe detail.
UPDATE platform.probe SET detail = 'sin detalle' WHERE detail IS NULL;
ALTER TABLE platform.probe ALTER COLUMN detail SET NOT NULL;
