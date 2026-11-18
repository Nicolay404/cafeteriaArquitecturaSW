# Data Model — Promociones y descuentos

Esquema propietario: `promotions`. Ninguna tabla de otro módulo se lee ni se escribe. Los IDs de
producto, categoría y menú son identificadores públicos de Catálogo (texto opaco); el de
administrador es el identificador público de Identidad.

## Promoción

| Campo | Tipo | Reglas |
|---|---|---|
| `id` | uuid | Generado por el servidor |
| `nombre` | texto 3–80 | Obligatorio; se muestra al cliente |
| `tipo` | `porcentaje` \| `monto_fijo` \| `nxm` \| `combo` | FR-002 |
| `valor` | según tipo | `porcentaje`: `puntosBasicos` 1–10000. `monto_fijo`: `centavos` > 0. `nxm`: `lleva` N ≥ 2, `paga` M con 1 ≤ M < N. `combo`: `productos` [{`productoId`, `cantidad` ≥ 1}] con ≥ 2 unidades en total y `precioCentavos` ≥ 0 |
| `alcance` | `{ productoIds[], categoriaIds[], menuIds[] }` | Al menos un ID en total, salvo `combo` (su alcance son sus productos). Una unidad está en el alcance si coincide con cualquiera de las tres listas (FR-003) |
| `inicio`, `fin` | timestamptz | `fin > inicio` (US1.4); ventana `[inicio, fin)` |
| `etiquetaFestividad` | texto ≤ 40, opcional | Agrupar en reportes (FR-004) |
| `prioridad` | entero 0–1000 | Por defecto 0; mayor gana (FR-007) |
| `acumulable` | booleano | Por defecto `false` (supuesto del spec) |
| `montoMinimoCentavos` | entero ≥ 0, opcional | Sobre el subtotal bruto |
| `cupon` | `{ codigo, limiteUsos? }`, opcional | Código 4–32 `[A-Z0-9-]`, único entre promociones no archivadas; `limiteUsos` ≥ 1 |
| `usos` | entero ≥ 0 | Solo lo cambia el consumo de usos (spec 006) |
| `estado` | `activa` \| `pausada` \| `archivada` | FR-001. Archivada es final y de solo lectura |
| `version` | entero | Bloqueo optimista (R9) |
| `creadaPor`, `actualizadaPor`, `creadaEn`, `actualizadaEn` | | Auditoría básica |

**Transiciones de estado**: `activa ⇄ pausada`, `activa|pausada → archivada`. «Vigente» no es un
estado guardado: es `estado = activa ∧ inicio ≤ t < fin`.

## Entrada del motor (no se persiste)

- **Línea**: `productoId`, `categoriaIds[]`, `menuId`, `cantidad` (entero ≥ 1), `precioBaseCentavos` (entero ≥ 0).
- **Solicitud**: `lineas[]`, `codigoCupon?`, `instante`.

## Cotización (salida; el pedido guarda su copia, FR-011)

- **Línea cotizada**: `productoId`, `cantidad`, `precioBaseCentavos` (unitario), `subtotalCentavos`, `descuentoCentavos`, `totalCentavos`, `promociones[]` (`promocionId`, `nombre`, `descuentoCentavos`).
- **Totales**: `subtotalCentavos`, `descuentoCentavos`, `totalCentavos` (= subtotal − descuento, ≥ 0).
- **Descuentos aplicados**: por promoción, el importe total y las líneas afectadas (FR-010).
- **Cupón**: `estado` (`aplicado`, `no_valido`, `monto_minimo`, `agotado`, `no_vigente`) y `faltanteCentavos` cuando aplica.
- **Instante** del cálculo, para reproducirlo.

## Tablas

```sql
CREATE SCHEMA promotions;

promotions.promotions (
  id uuid PK, nombre text, tipo text CHECK (...), valor jsonb, alcance jsonb,
  inicio timestamptz, fin timestamptz CHECK (fin > inicio),
  etiqueta_festividad text NULL, prioridad int, acumulable boolean,
  monto_minimo_centavos bigint NULL CHECK (>= 0),
  cupon_codigo text NULL, cupon_limite_usos int NULL, usos int NOT NULL DEFAULT 0 CHECK (usos >= 0),
  estado text CHECK (estado IN ('activa','pausada','archivada')), version int,
  creada_por text, actualizada_por text, creada_en timestamptz, actualizada_en timestamptz
)
UNIQUE (cupon_codigo) WHERE estado <> 'archivada'
INDEX (estado, fin)                -- carga de vigentes

promotions.coupon_redemptions (     -- idempotencia del consumo de usos
  promocion_id uuid, pedido_id text, creado_en timestamptz,
  PRIMARY KEY (promocion_id, pedido_id)
)

promotions.promotion_changes (      -- auditoría, solo INSERT (FR-014)
  id bigserial, promocion_id uuid, actor_id text, accion text,
  antes jsonb NULL, despues jsonb NULL, creado_en timestamptz
)
```

La migración es solo aditiva (expand). El número `NNN` se coordina con el equipo antes de crearla.
