-- Falla a mitad: la primera sentencia es válida y la segunda no. Nada debe quedar aplicado.
ALTER TABLE platform.probe ADD COLUMN broken text;
INSERT INTO platform.tabla_que_no_existe (id) VALUES (1);
