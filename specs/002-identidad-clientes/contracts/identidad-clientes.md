# Contrato HTTP — Identidad y Clientes

Prefijo `/api`. JSON; cookie de sesión `sid` (`HttpOnly; Secure; SameSite=Lax`); cabecera `X-CSRF-Token` en operaciones que cambian estado. Errores con forma uniforme `{ "codigo": "...", "mensaje": "...", "campos": [{ "campo": "...", "mensaje": "..." }] }`; el campo `mensaje` dice cómo corregir. Todo el conjunto está detrás del flag `identidad-habilitada` (404 si está apagado).

## Identidad

| Método y ruta | Rol | Cuerpo / respuesta | Notas |
|---|---|---|---|
| `POST /auth/registro` | público | `{nombre, correo, contrasena, aceptaPolitica}` → `202` | Siempre `202` y el mismo texto, exista o no el correo (FR-006). Límite por IP. |
| `POST /auth/confirmar-correo` | público | `{token}` → `204` | Un solo uso; `410` si caducó o ya se usó, con opción de reenvío. |
| `POST /auth/reenviar-confirmacion` | público | `{correo}` → `202` | Respuesta uniforme. |
| `POST /auth/acceso` | público | `{correo, contrasena}` → `200 {requiereMfa}` o `401` genérico | `429` con `Retry-After` al exceder el límite; `403 correo_sin_confirmar` solo tras credenciales correctas. |
| `POST /auth/mfa/verificar` | sesión parcial | `{codigo}` o `{codigoRecuperacion}` → `204` | Completa el acceso de personal y admin. |
| `POST /auth/cierre` | autenticado | → `204` | Destruye la sesión. |
| `POST /auth/recuperar` | público | `{correo}` → `202` | Enlace de 30 min, un solo uso. |
| `POST /auth/restablecer` | público | `{token, contrasena}` → `204` | Corta todas las sesiones de la cuenta. |
| `GET /auth/sesion` | autenticado | → `{rol, nombre, mfaVerificado}` | Sin PII innecesaria. |
| `POST /mfa/activar/iniciar` · `POST /mfa/activar/confirmar` | autenticado | URI `otpauth` y códigos de recuperación (una sola vez) | Obligatorio al primer acceso de personal y admin. |
| `POST /admin/personal` | admin + MFA | `{nombre, correo}` → `201` | Envía invitación; la persona define su contraseña y el segundo factor. |
| `POST /admin/personal/:id/desactivar` · `.../reactivar` | admin + MFA | → `204` | Desactivar corta sesiones al instante. |
| `POST /admin/personal/:id/restablecer-mfa` | admin + MFA + reautenticación | → `204` | Genera evento de seguridad. |

## Clientes

| Método y ruta | Rol | Cuerpo / respuesta | Notas |
|---|---|---|---|
| `GET /clientes/yo` · `PATCH /clientes/yo` | cliente | perfil `{nombre, telefono, preferencias}` | El `id` sale de la sesión. |
| `POST /clientes/yo/correo` · `POST /clientes/yo/correo/confirmar` | cliente + reautenticación | `{correoNuevo}` / `{token}` | Avisa al correo anterior. |
| `POST /clientes/yo/contrasena` | cliente + reautenticación | `{actual, nueva}` | Corta las demás sesiones. |
| `GET /clientes/yo/pedidos` | cliente | `[{id, fecha, total, estado}]` más reciente primero | Fuente: puerto `PedidosPorCliente` (Spec #6); vacío hasta entonces. |
| `GET /clientes/yo/datos` | cliente | inventario: dato, finalidad, retención | FR-012. |
| `GET /clientes/yo/consentimientos` · `PUT /clientes/yo/consentimientos/:finalidad` | cliente | `{estado}` | Cada cambio queda registrado con fecha. |
| `GET /clientes/yo/exportacion` | cliente + reautenticación | `cafeteria-export/1` en JSON | < 1 min. |
| `DELETE /clientes/yo` | cliente + reautenticación | `{confirmacion}` → `202` | `completada` o `pendiente_de_pedidos`. |

## Interfaces entre módulos (no HTTP)

- `ContactoDeCuenta` (Clientes → Identidad y Notificaciones): `contactoDe(personaId) → {nombre, correo}`; solo uso interno de envío.
- `PedidosPorCliente` (Pedidos → Clientes): `listar(clienteId)`, `hayEnCurso(clienteId)`; hasta el Spec #6 lo cubre un doble en pruebas.
- Eventos por outbox: `cuenta.desactivada`, `cliente.correo_cambiado`, `cliente.eliminado` (consumido por Pedidos para anonimizar; idempotente).
