# Modelo de datos — Spec #2

Dos esquemas, cada uno propiedad de su módulo. Ninguno lee tablas del otro: Identidad y Clientes se enlazan por `persona_id` (UUID) y por interfaces públicas.

## Esquema `identity` (módulo Identidad)

| Tabla | Campos principales | Notas |
|---|---|---|
| `cuenta` | `id`, `persona_id`, `indice_correo` (HMAC, único), `hash_contrasena` (Argon2id), `rol` (`cliente`/`personal`/`admin`), `estado` (`pendiente`/`activa`/`desactivada`), `correo_confirmado_en`, `creada_en`, `actualizada_en` | Sin correo en claro. Estados y transiciones: pendiente → activa; activa ⇄ desactivada. |
| `segundo_factor` | `cuenta_id`, `secreto_cifrado`, `activado_en`, `ultimo_paso_usado` | Una fila por cuenta; el secreto es PII técnica cifrada. |
| `codigo_recuperacion` | `id`, `cuenta_id`, `hash`, `usado_en` | 10 por cuenta. |
| `token_un_uso` | `id`, `cuenta_id`, `proposito` (`confirmar_correo`/`recuperar`/`invitacion`/`cambio_correo`), `hash`, `caduca_en`, `usado_en` | Solo el hash del token. |
| `evento_seguridad` | `id`, `cuenta_id` (nulo si no existe), `tipo`, `ip_truncada`, `agente`, `creado_en`, `detalle` (JSON sin datos sensibles) | Solo inserción. Tipos: registro, acceso_ok, acceso_fallido, bloqueo, recuperacion, cambio_rol, mfa_activado, mfa_restablecido, acceso_denegado, cuenta_desactivada. |
| `outbox_identidad` | `id`, `tipo`, `carga`, `creado_en`, `publicado_en` | Eventos `cuenta.desactivada`; escritos en la misma transacción. |

Sesiones y límites de intentos viven en Redis, no en Postgres: `sesion:<sha256>` → `{cuentaId, rol, mfaVerificado, creada, ultimaActividad}` y `limite:<tipo>:<clave>`.

## Esquema `customers` (módulo Clientes)

| Tabla | Campos principales | Notas |
|---|---|---|
| `persona` | `id`, `nombre_cifrado`, `correo_cifrado`, `telefono_cifrado`, `preferencias_cifradas` (JSON), `eliminada_en`, `creada_en` | Toda PII va cifrada por columna (AES-256-GCM con versión de clave). Cubre clientes, personal y administradores. |
| `consentimiento` | `id`, `persona_id`, `finalidad`, `estado` (`otorgado`/`retirado`), `cambiado_en`, `version_politica` | Un registro por cambio (historial); el vigente es el último. |
| `solicitud_derechos` | `id`, `persona_ref` (UUID, sin PII), `tipo` (`acceso`/`rectificacion`/`eliminacion`/`oposicion`/`portabilidad`), `estado` (`recibida`/`en_curso`/`pendiente_de_pedidos`/`completada`), `solicitada_en`, `completada_en`, `vence_en` | Sobrevive a la eliminación sin datos personales; `vence_en` = solicitud + 15 días. |
| `outbox_clientes` | `id`, `tipo`, `carga`, `creado_en`, `publicado_en` | `cliente.eliminado` y `cliente.correo_cambiado`. |

## Validaciones y transiciones

- Correo: normalizado (minúsculas, NFKC, recortado), máximo 254 caracteres; único por `indice_correo`.
- Nombre 1–120 caracteres; teléfono opcional en E.164; contraseña 12–128 caracteres.
- `cuenta.estado`: `pendiente → activa` solo al canjear `confirmar_correo`; `desactivada` corta sesiones.
- Eliminación: `solicitud_derechos` pasa a `completada` solo tras borrar la PII; con pedidos en curso queda `pendiente_de_pedidos`.
- Un cambio de correo no sustituye el vigente hasta confirmar el nuevo; el anterior recibe aviso.

## Inventario de datos personales (LOPDP, principio III)

| Dato | Finalidad | Base | Retención | Dónde |
|---|---|---|---|---|
| Nombre | Identificar al cliente y personalizar el servicio | Ejecución del contrato | Hasta eliminar la cuenta | `customers.persona` (cifrado) |
| Correo | Acceso, confirmación, avisos de seguridad y del pedido | Ejecución del contrato | Hasta eliminar la cuenta | `customers.persona` (cifrado); solo el HMAC en `identity.cuenta` |
| Teléfono (opcional) | Contacto sobre un pedido | Consentimiento | Hasta retirarlo o eliminar la cuenta | `customers.persona` (cifrado) |
| Preferencias (opcional) | Personalizar la experiencia | Consentimiento | Hasta retirarlas o eliminar la cuenta | `customers.persona` (cifrado) |
| Consentimientos | Prueba del consentimiento | Obligación legal | Mientras dure la relación y el plazo legal | `customers.consentimiento` |
| Contraseña (hash), segundo factor | Autenticación | Ejecución del contrato | Hasta eliminar la cuenta | `identity` |
| Eventos de seguridad (IP truncada, agente) | Detectar abusos y auditar | Interés legítimo | 12 meses (a confirmar) | `identity.evento_seguridad` |
| Solicitudes de derechos | Probar el cumplimiento de plazos | Obligación legal | Plazo legal (a confirmar) | `customers.solicitud_derechos` |

Al eliminar la cuenta desaparecen nombre, correo, teléfono, preferencias, hash, segundo factor y consentimientos personales; permanecen el registro mínimo de la solicitud, los eventos de seguridad (sin cuenta asociable) y los pedidos anonimizados.
