# Research — Carrito de compras

## R1. Qué guarda el carrito

- **Decisión**: por línea, `productoId`, `cantidad`, `agregadaEn` y la **última vista** (`precioBaseCentavos` y los IDs de las promociones que se mostraron). Nunca un precio con el que se vaya a cobrar.
- **Razón**: FR-005 (el cliente nunca fija un precio) y US3 (avisar comparando lo visto con lo actual). El precio de cobro lo recalcula Pedidos al confirmar (spec 006).
- **Alternativas**: guardar solo IDs, lo que impide detectar «cambió de precio»; guardar la cotización completa, que mezcla datos de Promociones en el carrito.

## R2. Almacenamiento: Redis con respaldo en Postgres

- **Decisión**: *write-through*. Cada cambio se escribe primero en Postgres (`cart.carts`, documento JSONB más `version`) y después en Redis. Las lecturas van a Redis y, si falta la clave o Redis falla, a Postgres, que luego repone Redis.
- **Razón**: Redis da latencia baja (SC-001) y Postgres durabilidad (un carrito no se pierde si Redis reinicia), como pide el ROADMAP («Redis con respaldo en PostgreSQL»).
- **Alternativas**: solo Redis con AOF (se puede perder un carrito en un fallo); solo Postgres (válido, pero más latencia en los picos).

## R3. Concurrencia entre dispositivos (US2.2)

- **Decisión**: las operaciones son **comandos** («añadir 1 de X», «fijar X en 3», «quitar X») que el servidor aplica sobre el estado más reciente, con **bloqueo optimista** por `version` (`UPDATE … WHERE version = $v`) y un par de reintentos ante conflicto. Nunca se sobrescribe el documento entero con lo que manda un dispositivo.
- **Razón**: dos dispositivos que añaden a la vez no se pisan, y cada dispositivo ve el estado más reciente al recargar (< 5 s, SC-002).

## R4. Límites y cantidades (FR-008, casos límite)

- Cantidad entera. `0` equivale a quitar y una negativa se rechaza con un mensaje que explica cómo corregirla.
- Tope por producto: `min(máximo configurable = 20, existencias disponibles si Catálogo las informa)`. Si se pide más, se **limita y se explica por qué** (`limitadaA`, `motivo: existencias | maximo_producto`).
- Tope por carrito: 50 unidades en total. Si se supera, se rechaza la operación y se explica.
- Los máximos son configurables. Hasta que exista la administración (spec 8) se leen de la configuración del servidor.

## R5. Deshacer (FR-002, US1.5)

- **Decisión**: el carrito guarda la **última eliminación** (línea completa y posición). Deshacer la restaura si el producto no se volvió a añadir; si se añadió, suma las cantidades respetando los límites. La próxima eliminación la reemplaza y vaciar el carrito permite deshacer el vaciado completo.
- Sin límite de tiempo (constitución I: nada de plazos que el cliente no controla).

## R6. Caducidad de 30 días (FR-003, US2.3)

- **Decisión**: `ultimaActividad` se actualiza con cada cambio, no al leer. Si al leer han pasado ≥ 30 días, el carrito se trata como vacío y se borra. Además, una tarea del worker purga cada día los carritos caducados (minimización de datos, LOPDP).
- Redis: TTL de 30 días que se renueva con cada cambio.

## R7. Avisos (FR-006, FR-007, US3)

| Tipo | Cuándo | ¿Bloquea confirmar? |
|---|---|---|
| `agotado` | Catálogo informa no disponible o existencias 0 | Sí, hasta quitarlo |
| `retirado` | El producto ya no está publicado | Sí |
| `fuera_de_horario` | Su menú no está disponible ahora | Sí, hasta que el menú abra o se quite |
| `existencias_insuficientes` | La cantidad supera las existencias actuales | Sí, hasta reducirla (se ofrece la cantidad máxima) |
| `cambio_precio` | El precio base actual ≠ el último visto | No; se muestran el anterior y el nuevo |
| `fin_promocion` | Una promoción vista ya no se aplica | No |

Al mostrar el carrito se actualiza la «última vista». El aviso informativo aparece **una vez** y el
cliente lo ve antes de confirmar (US3.2–3.3). La web anuncia los avisos en una región
`aria-live="polite"`, sin mover el foco (US3.4).

## R8. Puertos hacia otros módulos

- `CatalogoParaCarrito.productos(ids, instante)` → por ID: `{ estado: 'disponible' | 'agotado' | 'retirado', precioBaseCentavos, categoriaIds, menuId, dentroDeHorario, existencias? }`.
- `PreciosParaCarrito.cotizar(lineas, codigoCupon?, sujeto)` → la `Cotizacion` de Promociones.
- Los define el Carrito. Al integrarse Catálogo y Promociones se escribe un adaptador fino en `infraestructura/`; si su contrato real difiere, se ajusta el adaptador y no el dominio.

## R9. Cupón en el carrito

- El carrito guarda un `codigoCupon` opcional que el cliente introduce. Se valida con `cotizar` (estado del cupón del spec 005) y se muestra su estado. Si deja de ser válido, se informa sin bloquear.

## Preguntas abiertas para el equipo

- Identidad: ¿cómo obtiene otro módulo el `clienteId` de la petición (guard o decorador exportado por `modules/identidad/index.ts`)?
- Catálogo: ¿publicará existencias por producto o solo disponible/agotado? (Spec 3: existencias opcionales.)
- ¿Los máximos 20/50 los configura el administrador en el spec 8 o basta la configuración del servidor en la v1?
