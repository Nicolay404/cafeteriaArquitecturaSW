# Tareas — Spec #2: Identidad y gestión de clientes

**Entrada:** [plan.md](plan.md) (versión del commit `7a09d31`), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/identidad-clientes.md](contracts/identidad-clientes.md), [quickstart.md](quickstart.md).
**Rama:** `feature/spec-2`. **Alcance:** local con Docker (Postgres, Redis, RabbitMQ, Mailpit); sin nube ni cuentas de pago; sin Python.

**Tests obligatorios** (constitución VI): cada historia lleva unitarias (Vitest/Jest), integración con Testcontainers y E2E con Playwright + axe en los flujos críticos. Las políticas de contraseña, límites y sesiones se escriben con TDD (test que falla → implementación).

**Interfaz:** toda pantalla se construye con la skill `design-taste-frontend` (y `frontend-design`), tomando como **inspiración** las dos referencias del usuario («CAFÉ — Coffee & More» y «The Coffee Lounge»: fondo crema, acentos café oscuro, titulares serif, botones redondeados). No se copian textos, logos ni fotos de esas referencias, no se generan imágenes con IA y no se inventan datos del negocio. Contraste ≥ 7:1 (los marrones de las referencias se oscurecen si hace falta), teclado, foco visible, objetivos ≥ 44 px y movimiento reducible. La dirección visual (T009) y los textos finales requieren aprobación del equipo antes de darse por cerrados.

Formato: `- [ ] T### [P] [US#] Descripción con ruta`. Rutas relativas a la raíz del repositorio.

---

## Fase 1: Preparación

- [X] T001 Añadir las dependencias justificadas en el plan (`@node-rs/argon2`, `otplib`, `nodemailer` y sus tipos) a `proyecto/apps/api/package.json`, actualizar `proyecto/pnpm-lock.yaml` y comprobar que la imagen de `proyecto/apps/api/Dockerfile` sigue construyendo.
- [X] T002 [P] Añadir `PII_KEY_1`, `PII_INDEX_KEY`, `SESSION_SECRET` y `HIBP_ENABLED=false` (valores solo de prueba) a `proyecto/.env.example` y su validación en `proyecto/packages/config/src/env.ts`, con casos en `proyecto/tests/unit/config.spec.ts` (falta o longitud inválida rechazada).
- [X] T003 [P] Registrar el flag técnico `identidad-habilitada` en `TECHNICAL_FLAGS` de `proyecto/apps/api/src/platform/flags.service.ts` y su prueba en `proyecto/tests/integration/flags.int.spec.ts`.
- [X] T004 [P] Crear los esquemas compartidos (zod) de peticiones y respuestas del contrato en `proyecto/packages/contracts/src/identidad.ts` y `proyecto/packages/contracts/src/clientes.ts`, exportarlos en `proyecto/packages/contracts/src/index.ts` y probarlos en `proyecto/tests/unit/identidad-contracts.spec.ts`.

## Fase 2: Cimientos (bloquean todas las historias)

- [X] T005 Escribir la migración expansiva `proyecto/infra/migrations/010_identity.sql` (tablas `cuenta`, `segundo_factor`, `codigo_recuperacion`, `token_un_uso`, `evento_seguridad`, `outbox_identidad` del data-model) y probarla con `db:migrate` en `proyecto/tests/integration/identity-schema.int.spec.ts` (checksum, idempotencia, restricciones únicas).
- [X] T006 Escribir `proyecto/infra/migrations/011_customers.sql` (`persona`, `consentimiento`, `solicitud_derechos`, `outbox_clientes`) y su prueba en `proyecto/tests/integration/customers-schema.int.spec.ts`; ninguna columna de PII en claro.
- [X] T007 [P] TDD del cifrado de columnas AES-256-GCM con versión de clave e índice ciego HMAC en `proyecto/apps/api/src/modules/clientes/pii-cipher.ts` y `proyecto/apps/api/src/modules/clientes/pii-cipher.spec.ts` (ida y vuelta, manipulación detectada, rotación v1→v2, mismo correo normalizado → mismo índice).
- [X] T008 [P] TDD del limitador de intentos en Redis (ventana deslizante con Lua, `Retry-After`, falla cerrado sin Redis) en `proyecto/apps/api/src/modules/identidad/rate-limiter.ts` y `proyecto/tests/integration/rate-limiter.int.spec.ts`.
- [ ] T009 [P] Redactar la propuesta de dirección visual en `specs/002-identidad-clientes/decisions/visual-direction.md` con la skill `design-taste-frontend`: paleta crema/café con contrastes medidos ≥ 7:1, tipografía serif para titulares y sans para texto, componentes de formulario, estados de error y foco; citar las dos referencias como inspiración y marcarla **pendiente de aprobación del equipo**.
- [ ] T010 Crear los tokens y componentes base de formulario accesibles (campo con etiqueta, ayuda y error asociado, resumen de errores enfocable, botón ≥ 44 px, mostrar u ocultar contraseña) en `proyecto/packages/ui/src/` según T009, con pruebas de Testing Library en `proyecto/packages/ui/src/form.spec.tsx`.
- [X] T011 Implementar el puerto `MailPort`, el adaptador SMTP y las plantillas de texto plano (confirmación, aviso de cuenta existente, recuperación, invitación, bloqueo, cambio de correo) en `proyecto/apps/api/src/modules/notificaciones/`, con reintentos y prueba contra Mailpit real (el envío por outbox lo cablea cada servicio en US1/US2: pendiente) en `proyecto/tests/integration/mail.int.spec.ts`.
- [X] T012 Implementar el almacén de sesiones opacas en Redis (crear, tocar, caducidad deslizante 8 h y absoluta 30 días, cortar todas las de una cuenta) y el token CSRF en `proyecto/apps/api/src/modules/identidad/sessions.ts`, con `proyecto/tests/integration/sessions.int.spec.ts`.
- [X] T013 Implementar el guard de sesión, `@Roles()`, `RequiereMfa` y `Reautenticado(≤5 min)` en `proyecto/apps/api/src/modules/identidad/guards.ts`, y el registro de eventos de seguridad sin datos sensibles (IP truncada) en `proyecto/apps/api/src/modules/identidad/security-events.ts`, con pruebas unitarias en `proyecto/apps/api/src/modules/identidad/guards.spec.ts`.
- [X] T014 Exponer las interfaces públicas entre módulos (`ContactoDeCuenta` en `proyecto/apps/api/src/modules/clientes/index.ts`; `PedidosPorCliente` como puerto con doble en `proyecto/tests/fixtures/pedidos-por-cliente.ts`) y una prueba en `proyecto/tests/unit/module-boundaries.spec.ts` que falla si Identidad importa internos de Clientes o lee su esquema.

**Punto de control:** migraciones aplicadas, cifrado, límites, sesiones, correo y guards probados con servicios reales.

## Fase 3: US1 — Crear una cuenta e iniciar sesión (P1) 🎯 MVP

**Objetivo:** registro, confirmación, acceso, cierre y recuperación, sin revelar si un correo existe.
**Prueba independiente:** registrarse, confirmar en Mailpit, entrar, salir y recuperar la contraseña solo con teclado y lector de pantalla.

- [ ] T015 [P] [US1] TDD de la política de contraseñas (12–128 caracteres, NFKC, lista local de comunes, puerto de brechas con adaptador HIBP apagado por defecto) en `proyecto/apps/api/src/modules/identidad/password-policy.ts` y `.spec.ts`.
- [ ] T016 [P] [US1] TDD de los tokens de un solo uso (hash, propósito, caducidad 24 h y 30 min, canje atómico, invalidar anteriores) en `proyecto/apps/api/src/modules/identidad/one-time-tokens.ts` y `proyecto/tests/integration/one-time-tokens.int.spec.ts`.
- [ ] T017 [US1] Pruebas de integración del contrato de US1 en `proyecto/tests/integration/auth-us1.int.spec.ts`: registro → 202 uniforme (correo nuevo y existente, aviso al titular), confirmación, acceso correcto y genérico, `correo_sin_confirmar`, bloqueo con `Retry-After` y aviso, recuperación y restablecimiento que corta sesiones, enlaces caducados o usados (410).
- [ ] T018 [US1] Implementar en Clientes la creación de `persona` cifrada y `ContactoDeCuenta` en `proyecto/apps/api/src/modules/clientes/personas.repository.ts`.
- [ ] T019 [US1] Implementar el servicio y controlador de registro, confirmación y reenvío (con hash ficticio para igualar tiempos) en `proyecto/apps/api/src/modules/identidad/registration.service.ts` y `proyecto/apps/api/src/modules/identidad/auth.controller.ts`.
- [ ] T020 [US1] Implementar acceso, cierre de sesión, recuperación y restablecimiento con límites de T008 y eventos de seguridad en `proyecto/apps/api/src/modules/identidad/login.service.ts` y `auth.controller.ts`.
- [ ] T021 [P] [US1] Construir las pantallas `registro`, `confirmar`, `acceso` y `recuperar` en `proyecto/apps/web/src/app/(cuenta)/` con los componentes de T010 (`autocomplete` correcto, foco al primer error, mensajes que dicen cómo corregir, sin límites de tiempo) usando la skill `design-taste-frontend`.
- [ ] T022 [US1] E2E y axe del flujo completo de US1 con Mailpit en `proyecto/tests/e2e/identidad-us1.spec.ts` (solo teclado; sin violaciones axe AAA aplicables).
- [ ] T023 [US1] Registrar la evidencia (comandos, resultados, prueba manual con NVDA) en `specs/002-identidad-clientes/evidence/us1.md` y marcar las tareas verificadas.

## Fase 4: US2 — Personal y administradores con doble factor (P1)

**Objetivo:** el administrador gestiona el personal; personal y admin entran con TOTP y solo ven lo de su rol.
**Prueba independiente:** crear personal, configurar TOTP, entrar y comprobar 403 registrado en una función de admin.

- [ ] T024 [P] [US2] TDD del TOTP (ventana ±1, un uso por paso) y de los 10 códigos de recuperación en `proyecto/apps/api/src/modules/identidad/mfa.ts` y `mfa.spec.ts`.
- [ ] T025 [P] [US2] Script `identity:seed-admin` que crea el primer administrador desde variables de entorno y se niega con `APP_ENV=production`, en `proyecto/scripts/identity/seed-admin.ts`, `proyecto/package.json` y `proyecto/tests/integration/seed-admin.int.spec.ts`.
- [ ] T026 [US2] Pruebas de integración de US2 en `proyecto/tests/integration/auth-us2.int.spec.ts`: invitación, MFA exigido antes de funciones del personal, 403 con evento al usar función de admin, desactivación que corta sesiones al instante, reactivación y restablecimiento de MFA con reautenticación.
- [ ] T027 [US2] Implementar activación y verificación de MFA y sesión parcial en `proyecto/apps/api/src/modules/identidad/mfa.controller.ts`.
- [ ] T028 [US2] Implementar la gestión de personal (crear con invitación, desactivar, reactivar, restablecer MFA) con evento `cuenta.desactivada` por outbox en `proyecto/apps/api/src/modules/identidad/staff.service.ts` y `admin.controller.ts`.
- [ ] T029 [P] [US2] Construir las pantallas de configuración de TOTP (secreto en texto además del QR, códigos de recuperación descargables) y de gestión de personal en `proyecto/apps/web/src/app/(cuenta)/mfa/` y `proyecto/apps/web/src/app/(admin)/personal/` con la skill `design-taste-frontend`.
- [ ] T030 [US2] E2E y axe de US2 en `proyecto/tests/e2e/identidad-us2.spec.ts` (TOTP calculado en la prueba) y evidencia en `specs/002-identidad-clientes/evidence/us2.md`.

## Fase 5: US3 — Perfil e historial (P2)

**Objetivo:** el cliente edita sus datos, cambia correo y contraseña con reautenticación y ve su historial.
**Prueba independiente:** editar el perfil y abrir el historial (vacío hasta el Spec #6, con el doble del puerto en pruebas).

- [ ] T031 [US3] Pruebas de integración en `proyecto/tests/integration/clientes-us3.int.spec.ts`: lectura y edición del perfil propio (nunca el de otro), cambio de correo con confirmación y aviso al anterior, cambio de contraseña que corta las demás sesiones, historial ordenado del más reciente al más antiguo con el doble.
- [ ] T032 [US3] Implementar `GET/PATCH /clientes/yo`, cambio de correo y de contraseña en `proyecto/apps/api/src/modules/clientes/profile.controller.ts` y `profile.service.ts`.
- [ ] T033 [US3] Implementar `GET /clientes/yo/pedidos` sobre el puerto `PedidosPorCliente` (vacío en ejecución hasta el Spec #6) en `proyecto/apps/api/src/modules/clientes/orders-history.controller.ts`.
- [ ] T034 [P] [US3] Construir las pantallas `perfil` y `pedidos` (estado vacío explicado) en `proyecto/apps/web/src/app/(cuenta)/` con la skill `design-taste-frontend`, confirmación de guardado anunciada con `role="status"`.
- [ ] T035 [US3] E2E y axe de US3 en `proyecto/tests/e2e/clientes-us3.spec.ts` y evidencia en `specs/002-identidad-clientes/evidence/us3.md` (historial real: no evaluable hasta el Spec #6).

## Fase 6: US4 — Derechos sobre mis datos (P2)

**Objetivo:** ver qué datos se guardan, gestionar consentimientos, descargar y eliminar la cuenta.
**Prueba independiente:** descargar los datos, retirar marketing y eliminar la cuenta; después no se puede entrar y no queda PII.

- [ ] T036 [US4] Pruebas de integración en `proyecto/tests/integration/clientes-us4.int.spec.ts`: inventario de datos, historial de consentimientos con fecha, exportación `cafeteria-export/1` completa en < 1 min, eliminación con reautenticación (PII borrada, acceso imposible, evento `cliente.eliminado` en outbox), caso con pedido en curso → `pendiente_de_pedidos` y búsqueda por el correo eliminado sin resultados.
- [ ] T037 [US4] Implementar inventario y consentimientos en `proyecto/apps/api/src/modules/clientes/privacy.controller.ts` y `consents.service.ts`.
- [ ] T038 [US4] Implementar exportación y eliminación con anonimización y solicitud de derechos sin PII en `proyecto/apps/api/src/modules/clientes/rights.service.ts`.
- [ ] T039 [P] [US4] Construir la pantalla `privacidad` (inventario, consentimientos, descarga y eliminación con confirmación explícita y reautenticación) en `proyecto/apps/web/src/app/(cuenta)/privacidad/` con la skill `design-taste-frontend`.
- [ ] T040 [US4] E2E y axe de US4 en `proyecto/tests/e2e/clientes-us4.spec.ts` y evidencia en `specs/002-identidad-clientes/evidence/us4.md` (anonimización de pedidos: no evaluable hasta el Spec #6).

## Fase 7: Cierre transversal

- [ ] T041 [P] Revisar con la skill `design-taste-frontend` todas las pantallas del spec contra `decisions/visual-direction.md` y medir contrastes; registrar en `specs/002-identidad-clientes/evidence/accesibilidad.md` la prueba manual con teclado y NVDA de los cuatro flujos (SC-003).
- [ ] T042 [P] Auditar que ningún log, evento ni respuesta contiene contraseñas, tokens, códigos o PII en claro, con una prueba en `proyecto/tests/integration/no-sensitive-logs.int.spec.ts` (FR-016).
- [ ] T043 [P] Añadir los datos nuevos al inventario LOPDP compartido (`docs/` o `specs/002-identidad-clientes/data-model.md`) y señalar las decisiones pendientes (jurisdicción, retención de eventos, CAPTCHA) en `ROADMAP.md`.
- [ ] T044 Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` y `pnpm test:e2e`, comprobar el Quality Gate de Sonar en el PR (cobertura ≥ 80 % del código nuevo) y recorrer `quickstart.md` completo; dejar el resultado en `specs/002-identidad-clientes/evidence/cierre.md`.
- [ ] T045 Presentar la dirección visual, los textos y las pantallas al equipo y registrar su aprobación (o los cambios pedidos) en `decisions/visual-direction.md`; hasta entonces el flag `identidad-habilitada` sigue apagado por defecto.

---

## Dependencias

```text
Fase 1 (T001–T004) → Fase 2 (T005–T014) → US1 (T015–T023) → US2 (T024–T030)
                                         └→ US3 (T031–T035) y US4 (T036–T040), tras US1
Fase 7 tras las historias que se entreguen.
```

- US2 reutiliza el acceso de US1; US3 y US4 necesitan sesión de cliente (US1) pero no dependen entre sí ni de US2.
- T009 (dirección visual) va antes de T010 y de toda pantalla; T045 cierra la aprobación.

## Paralelismo

- Fase 2: T007, T008 y T009 a la vez; T011 y T012 en paralelo tras las migraciones.
- US1: T015 y T016 a la vez; T021 (pantallas) en paralelo con T019–T020 una vez fijado el contrato.
- US2: T024 y T025 a la vez; T029 en paralelo con T027–T028.
- US3 y US4 pueden desarrollarse en paralelo por personas distintas tras US1.

## Estrategia

1. **MVP:** Fases 1–3 (US1) con el flag apagado por defecto; demostrar con `quickstart.md`.
2. Añadir US2 (requisito de seguridad del personal antes de cualquier función de rol).
3. US3 y US4 (obligación LOPDP antes de datos reales).
4. Cierre transversal y aprobación del equipo.

Cada tarea se integra en commits atómicos y verdes con alcance `identidad`, `clientes`, `notificaciones` o `web`; sin coautoría de Claude.
