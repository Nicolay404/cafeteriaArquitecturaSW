# Data Model — Carrito de compras

Almacenamiento propio: claves Redis `carrito:<clienteId>` y esquema PostgreSQL `cart`. Sin PII:
`clienteId` es el identificador público de Clientes, y `productoId` y `promocionId` son IDs públicos
de Catálogo y Promociones.

## Carrito

| Campo | Tipo | Reglas |
|---|---|---|
| `clienteId` | texto | Clave; uno por cliente (FR-001); sale de la sesión |
| `lineas` | `Linea[]` | Sin productos repetidos; orden de inserción |
| `codigoCupon` | texto, opcional | Normalizado (mayúsculas, sin espacios) |
| `ultimaEliminacion` | `{ linea, posicion }` o `{ lineas }` si se vació, opcional | Para deshacer (R5) |
| `ultimaActividad` | instante UTC | Se actualiza con cada cambio; caduca a los 30 días (R6) |
| `version` | entero | Bloqueo optimista (R3) |

## Línea

| Campo | Tipo | Reglas |
|---|---|---|
| `productoId` | texto | No vacío |
| `cantidad` | entero | 1 ≤ cantidad ≤ máximo por producto (20) y por existencias |
| `agregadaEn` | instante UTC | |
| `vista` | `{ precioBaseCentavos, promocionIds[] }`, opcional | Lo último que vio el cliente; base de los avisos (R1, R7) |

Total de unidades del carrito ≤ 50 (configurable).

## Vista del carrito (salida, no se persiste)

- Por línea: `productoId`, `cantidad`, `precioBaseCentavos`, `descuentoCentavos`, `totalCentavos`, `promociones[]` (nombre y ahorro), `avisos[]`.
- Totales: `subtotalCentavos`, `descuentoCentavos`, `totalCentavos` (FR-004).
- `avisos[]`: `{ tipo, productoId, bloquea, precioAnteriorCentavos?, precioNuevoCentavos?, promocionId?, cantidadMaxima? }` (R7).
- `confirmable`: `true` si no hay avisos que bloquean y hay al menos una línea (FR-007).
- `cupon?`: el estado devuelto por Promociones.
- `puedeDeshacer`: hay una eliminación pendiente de deshacer.
- `version`.

## Tablas (`030_cart.sql`, solo aditiva)

```sql
CREATE SCHEMA IF NOT EXISTS cart;

cart.carts (
  cliente_id text PRIMARY KEY,
  documento jsonb NOT NULL,          -- lineas, codigoCupon, ultimaEliminacion
  version integer NOT NULL DEFAULT 1,
  ultima_actividad timestamptz NOT NULL
)
INDEX (ultima_actividad)             -- purga diaria de caducados
```
