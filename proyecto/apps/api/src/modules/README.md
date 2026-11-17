# Límites de dominio — esqueletos T008

Solo módulos Nest vacíos y exportaciones públicas index.ts. Sin controladores, servicios de negocio, tablas, migraciones, autenticación ni arranque de API. Las futuras importaciones externas al módulo entran por su index.ts; jamás por repositorios, entidades o implementación interna.

| Módulo         | Esquema/almacenamiento propietario futuro                                                       |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Identidad      | identity                                                                                        |
| Clientes       | customers; PII cifrada, solo aquí                                                               |
| Catálogo       | catalog; menús y productos de CU003, disponibilidad/versiones                                   |
| Promociones    | promotions; reglas y vigencias, referencia IDs públicos de Catálogo                             |
| Carrito        | Redis con respaldo Postgres, esquema por concretar en su spec                                   |
| Pedidos        | orders                                                                                          |
| Pagos          | payments                                                                                        |
| Notificaciones | Consumidor de eventos; propiedad de datos por concretar                                         |
| Reportes       | Proyecciones de lectura autorizadas en réplica; propiedad por concretar, no SQL cruzado directo |

Ninguna tabla existe por este documento. No consultar/escribir esquema ajeno. Compartir DTO/interfaces/eventos explícitos mediante API pública, no objetos ORM ni repositorios. Los dominios no importan la implementación técnica platform. El lint restringe entrypoints; los permisos de base de datos y reglas de SQL se definirán cuando existan repositorios, sin afirmar que lint compruebe permisos de DB hoy.

Admin es actor, no un módulo dueño de tablas ajenas. Cliente, Cocineros y Admin del draw.io siguen separados; correspondencia de Cocineros con personal y semántica de Oferta requieren revisión del equipo. Estos esqueletos no implementan CU003 ni otros specs.
