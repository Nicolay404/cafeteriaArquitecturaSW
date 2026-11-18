# Contrato: endpoints de administración de promociones

**BLOQUEADO** hasta que Identidad (spec 2) publique su guard de sesión y rol. Todos requieren rol
`admin` con MFA verificado en el servidor, y están detrás del flag `promociones.admin`.

| Método y ruta | Uso | Respuestas |
|---|---|---|
| `GET /admin/promociones?estado=&etiqueta=` | Listar | 200 |
| `POST /admin/promociones` | Crear (FR-001) | 201; 422 con errores por campo y cómo corregirlos (US1.4) |
| `GET /admin/promociones/:id` | Detalle con historial de cambios | 200, 404 |
| `PUT /admin/promociones/:id` | Editar (cabecera `If-Match: <version>`) | 200; 409 si otra persona la cambió; 422 |
| `POST /admin/promociones/:id/pausar` · `/reanudar` · `/archivar` | Transiciones de estado | 200; 409 transición no permitida |
| `POST /admin/promociones/simular` | Simular un carrito en un instante futuro (FR-013) | 200 con `Cotizacion` |

Las fechas se envían en hora local de la cafetería (`YYYY-MM-DDTHH:mm`) y se convierten a UTC en el
servidor. Cada cambio inserta una fila en `promotions.promotion_changes` (FR-014).

Para clientes no se expone un endpoint propio: la tienda (spec 3) y el carrito (spec 4) obtienen
precios con descuento a través de `PromocionesApi.cotizar()`.
