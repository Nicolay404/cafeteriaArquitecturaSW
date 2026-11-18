# Base del Spec #2 y backend de US1 — evidencia

2026-11-18 · rama `feature/spec-2` (desde `main` en `b00a1ea`) · Windows 11, Docker Desktop. Todo contra Postgres 17, Redis 8 y Mailpit reales (Testcontainers); sin nube.

## Qué está hecho y verificado

| Tareas | Entrega | Verificación |
|---|---|---|
| T001–T004 | Dependencias (`@node-rs/argon2`, `otplib`, `nodemailer`, `zod`), claves de PII y sesión en la configuración (`.env.example` solo con valores de prueba, rechazados fuera de local), flag `identidad-habilitada` apagado por defecto, esquemas compartidos del contrato | 15 + 7 tests unitarios y de configuración; Gitleaks sin hallazgos |
| T005–T006 | Migraciones `010_identity.sql` y `011_customers.sql` (expansivas) | 9 tests con Postgres real: idempotencia, restricciones, ninguna columna de PII en claro, eventos de solo inserción, cascadas |
| T007 | Cifrado AES-256-GCM por columna con versión de clave e índice ciego del correo | 19 tests (TDD, vistos en rojo antes): manipulación detectada, columna atada por AAD, rotación |
| T008 | Limitador de intentos con ventana deslizante atómica en Redis | 10 tests con Redis real: 25 intentos simultáneos con límite 5 dejan pasar exactamente 5; falla cerrado si Redis no responde |
| T011 | Puerto de correo, adaptador SMTP y plantillas sin secretos | 10 tests con Mailpit real |
| T012 | Sesiones opacas en Redis (HMAC del token, caducidad deslizante y absoluta, corte por cuenta, CSRF) | 13 tests con Redis real |
| T013 | Decisión de acceso por rol, MFA y reautenticación; guard; eventos de seguridad (IP truncada, sin datos sensibles) | 29 tests unitarios |
| T014 | Puertos `ContactoDeCuenta` y `PedidosPorCliente` (con doble en memoria) y prueba de fronteras | 8 tests de límites con el ESLint real |
| T009–T010 | Propuesta visual (pendiente de aprobación) y componentes de formulario accesibles con guardia de contraste | 33 tests, incluidos 21 contrastes recalculados desde el CSS |
| T015 | Política de contraseñas (12–128, comunes, datos propios, brechas por k-anonimato) | 38 tests |
| T016 | Enlaces de un solo uso (solo hash; canje atómico) | 14 tests con Postgres real: 20 canjes simultáneos dejan pasar uno |
| T017–T020 | Registro, confirmación, acceso, cierre, recuperación y límites por HTTP | 16 tests de punta a punta (ver abajo) |

Resultado global al cerrar este bloque: `pnpm typecheck`, `pnpm lint`, `pnpm format:check` sin errores; `pnpm test:unit` 191 (Vitest) + 93 (Jest) pasan; `pnpm test:integration` 17 suites pasan.

## Lo que comprueban los 16 tests de US1 por HTTP

- Registro → correo en Mailpit → no entra sin confirmar (403 `correo_sin_confirmar`) → confirma → entra (cookie `HttpOnly; SameSite=Lax`, `Cache-Control: no-store`) → sesión → cierre exige el token CSRF.
- Registrarse con un correo existente devuelve **exactamente** la misma respuesta que con uno nuevo, el titular recibe el aviso y no se duplica la cuenta (también con dos registros simultáneos).
- Contraseña incorrecta y cuenta inexistente devuelven el mismo cuerpo 401; tras 5 fallos hay bloqueo 429 con `Retry-After`, un único aviso al titular y ni la contraseña correcta pasa; bloquear un correo que no existe no manda nada a nadie.
- Registro limitado a 5 por hora y por IP.
- Recuperación: enlace de un solo uso; una contraseña débil devuelve 400 **sin gastar** el enlace; el éxito corta las sesiones vigentes y la contraseña vieja deja de valer; un enlace caducado o usado explica qué hacer (410 y «Pide uno nuevo»).
- Recuperar responde igual exista o no la cuenta y no manda correo a un extraño.
- Errores de formulario por campo con mensaje que dice cómo corregir.
- Flag apagado: las rutas responden 404 y vuelven al encenderlo.
- En la base no queda ningún dato personal en claro (correo, nombre, contraseña); los eventos de seguridad no contienen correos ni contraseñas.

## Límites, sin maquillar

- **Faltan** las pantallas de US1 (T021), el E2E con teclado y axe (T022) y la prueba manual con lector de pantalla (T023): la historia no está cerrada.
- El envío de correos es en segundo plano con reintentos, **no** por outbox: si el proceso cae entre crear la cuenta y enviar, la persona pide el reenvío. Pendiente cablear el outbox.
- La comprobación de contraseñas filtradas contra un servicio externo (HIBP) está implementada y probada con un doble de `fetch`, pero no se ejecutó contra el servicio real; en local queda apagada.
- La confirmación del correo registra el evento con tipo `registro` y detalle `correo_confirmado`; no hay un tipo propio.
- El commit `e030d01` (migraciones) dejó un test del CLI de migraciones desactualizado, corregido en `623adc6`; ese commit intermedio no pasaba por sí solo toda la suite.
- Los tests de integración usan una IP de origen única (127.0.0.1): los límites por IP se probaron, pero no el comportamiento detrás de un proxy (`trust proxy` aún sin configurar).
