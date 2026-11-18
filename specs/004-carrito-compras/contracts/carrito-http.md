# Contrato HTTP — Carrito

**BLOQUEADO** hasta que Identidad (spec 2) exponga cómo obtener el `clienteId` de la sesión. Todos
los endpoints exigen sesión de rol `cliente`; el carrito es siempre el del cliente de la sesión.
Van detrás del flag `carrito-habilitado` y usan el formato de error del contrato de Identidad:
`{ codigo, mensaje, campos[] }`, donde `mensaje` dice cómo corregir. Las operaciones que cambian
estado llevan `X-CSRF-Token`.

| Método y ruta | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/carrito` | — | `200` vista del carrito (data-model) |
| `POST /api/carrito/lineas` | `{ productoId, cantidad }` | `200` vista; si se limitó, `ajuste: { productoId, cantidad, motivo }` |
| `PUT /api/carrito/lineas/:productoId` | `{ cantidad }` (0 = quitar) | `200` vista; `422` si es negativa o no entera |
| `DELETE /api/carrito/lineas/:productoId` | — | `200` vista con `puedeDeshacer: true` |
| `POST /api/carrito/deshacer` | — | `200` vista; `409` si no hay nada que deshacer |
| `DELETE /api/carrito` | — | `200` vista vacía con `puedeDeshacer: true` |
| `PUT /api/carrito/cupon` · `DELETE /api/carrito/cupon` | `{ codigo }` | `200` vista con el estado del cupón; `429` con `Retry-After` si hay demasiados intentos |

Errores de dominio: `422 producto_no_disponible` (al añadir un producto agotado, retirado o fuera de
horario), `422 limite_carrito` (más de 50 unidades), `404` si el producto no existe.
