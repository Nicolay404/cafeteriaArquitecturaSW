# Migraciones — numeración por bloques

Todas las migraciones viven en esta carpeta compartida. Para que dos specs no se pisen el número, **cada spec tiene un bloque reservado**:

| Bloque | Dueño | Esquema |
|---|---|---|
| 001–009 | Plataforma (Spec #1). `001` existe; `002_delivery_telemetry.sql` está reservada | `platform`, telemetría |
| 010–019 | Spec #2, Identidad y Clientes (`010_identity`, `011_customers`) | `identity`, `customers` |
| 020–029 | Spec #3, Catálogo | `catalog` |
| 030–039 | Spec #4, Carrito | por definir en su spec |
| 040–049 | Spec #5, Promociones | `promotions` |
| 050–059 | Spec #6, Pedidos | `orders` |
| 060–069 | Spec #7, Pagos | `payments` |
| 070–079 | Spec #8, Reportes | por definir en su spec |

## Reglas

- Nombre `NNN_descripcion.sql` (minúsculas, números y `_`); el runner rechaza otros nombres y versiones repetidas.
- Una migración solo toca **su propio esquema** y empieza con `CREATE SCHEMA IF NOT EXISTS <esquema>;`. Entre esquemas no hay claves foráneas: se enlazan por identificadores públicos (constitución V).
- Son **expansivas** (expand/contract): la versión anterior de la aplicación debe seguir funcionando. Una migración ya aplicada no se edita ni se borra: se corrige con una nueva dentro del mismo bloque (constitución VII).
- Nada de PII en claro: lo personal vive solo en `customers`, cifrado por columna.
- El orden de aplicación es por número, pero el runner aplica las pendientes aunque lleguen salteadas, así que los huecos entre bloques no son un problema.
- Si un spec necesita más de diez migraciones, se acuerda con el equipo antes de invadir el bloque siguiente.
