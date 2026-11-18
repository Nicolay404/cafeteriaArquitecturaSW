# Plan — Spec #2: Identidad y gestión de clientes

**Rama:** `feature/spec-2` (desde `main` en `b00a1ea`) · **Fecha:** 2026-11-18 · **Estado:** propuesta técnica para revisión del equipo.

Entrada: [spec.md](spec.md), sin modificar. Fuentes: `.specify/memory/constitution.md` v1.0.0 (prevalece), `promtp.md` §RF-01 y §5, `ROADMAP.md` Fase 1, `AGENTS.md` y el plan del Spec #1. Complementan el diseño [research.md](research.md), [data-model.md](data-model.md), [contracts/identidad-clientes.md](contracts/identidad-clientes.md) y [quickstart.md](quickstart.md).

## 1. Resumen

Dos módulos del monolito NestJS: **Identidad** (cuentas, credenciales, sesiones, roles, segundo factor y eventos de seguridad; esquema `identity`) y **Clientes** (perfil con PII cifrada por columna, consentimientos, solicitudes de derechos LOPDP, exportación y eliminación; esquema `customers`). La web (Next.js) añade registro, acceso, recuperación, perfil, historial y privacidad. Todo se desarrolla y verifica en local con Docker (`specs/001-plataforma-entrega/decisions/alcance-local.md`): Postgres, Redis y Mailpit reales; nada de nube.

Fuera de alcance (spec): inicio con redes sociales y compra como invitado. El **historial de pedidos** (FR-011) depende del módulo Pedidos (Spec #6): aquí se entrega el contrato y la pantalla con estado vacío; los datos reales se conectan cuando exista Pedidos (no evaluable hasta entonces).

## 2. Contexto técnico

| Aspecto | Decisión |
|---|---|
| Lenguaje | TypeScript (Node 24, sin Python). |
| API | NestJS 12 en `proyecto/apps/api/src/modules/{identidad,clientes,notificaciones}` (los esqueletos ya existen). |
| Web | Next.js 16 en `proyecto/apps/web`, sin librería de UI nueva. |
| Almacenamiento | PostgreSQL 17 (esquemas `identity` y `customers`, SQL parametrizado, migraciones expand/contract con `db:migrate`); Redis 8 para sesiones, límites de intentos y estado efímero. |
| Contraseñas | Argon2id (`@node-rs/argon2`, binarios precompilados, sin node-gyp). |
| Segundo factor | TOTP RFC 6238 (`otplib`) y 10 códigos de recuperación de un solo uso (guardados con hash). |
| Cifrado de PII | AES-256-GCM por columna con clave de entorno versionada; índice ciego HMAC-SHA-256 para búsquedas exactas. |
| Correo | SMTP a Mailpit en local; envío mediante un puerto del módulo Notificaciones. |
| Pruebas | Vitest (unitarias), Jest + Testcontainers (integración con Postgres, Redis y Mailpit reales), Playwright + axe (E2E y accesibilidad). |
| Rendimiento | Registro < 2 min de usuario (SC-001); exportación < 1 min (SC-005); Argon2id calibrado a unos 100–250 ms por hash. |
| Escala | API sin estado: sesión y límites en Redis, compartidos por N instancias. |

## 3. Constitution Check

- [x] **I. Accesibilidad AAA:** etiquetas, errores asociados y foco al primer error, sin límites de tiempo, objetivos ≥ 44 px, contraste ≥ 7:1; se verifica con axe y prueba manual de teclado y lector. La dirección visual y los textos finales requieren aprobación del equipo (AGENTS.md); se parte de los tokens existentes y de la skill `design-taste-frontend`.
- [x] **II. Seguridad:** Argon2id; MFA obligatorio para personal y administradores; rol comprobado en servidor por operación; sesiones opacas en cookie `HttpOnly; Secure; SameSite=Lax` con token CSRF; límites de intentos; respuestas sin enumeración de cuentas; sin secretos en el repo. Ningún dato de tarjeta.
- [x] **III. LOPDP:** inventario de datos y retención en `data-model.md`; la PII vive solo en `customers` y cifrada; Identidad guarda únicamente el índice ciego del correo; consentimientos con historial; exportación JSON y eliminación con anonimización.
- [x] **IV. Escalabilidad y consistencia:** servicios sin estado; operaciones sensibles idempotentes (canje de enlaces, eliminación); eventos `cuenta.desactivada` y `cliente.eliminado` por outbox en la misma transacción. No hay pedidos ni pagos aquí.
- [x] **V. Límites de dominio:** Identidad y Clientes se comunican por interfaces públicas (`index.ts`) y eventos; sin acceso cruzado a tablas; la regla de lint de fronteras ya está activa.
- [x] **VI. Calidad:** TDD en políticas de contraseña, límites y flujos de sesión; integración con servicios reales; E2E de las dos historias P1; cobertura ≥ 80 % del código nuevo (Sonar).
- [x] **VII. Reversibilidad:** migraciones solo expansivas; todo tras el flag `identidad-habilitada` hasta cerrar los flujos P1; commits atómicos con alcance `identidad` o `clientes`.
- [x] **Plataforma:** TypeScript sin Python; despliegue fuera de alcance (local).

Sin violaciones que justificar. Dependencias nuevas justificadas: `@node-rs/argon2` (Argon2id exigido), `otplib` (TOTP estándar, evita implementarlo a mano) y `nodemailer` (cliente SMTP).

## 4. Estructura

```text
specs/002-identidad-clientes/{spec.md, plan.md, research.md, data-model.md, quickstart.md, contracts/}
proyecto/
  apps/api/src/modules/identidad/       # cuentas, credenciales, sesiones, MFA, eventos de seguridad, guards
  apps/api/src/modules/clientes/        # perfil, consentimientos, derechos, exportación, eliminación
  apps/api/src/modules/notificaciones/  # puerto de correo, adaptador SMTP y plantillas
  apps/web/src/app/(cuenta)/{registro,acceso,recuperar,confirmar,mfa,perfil,pedidos,privacidad}/
  packages/contracts/src/{identidad,clientes}.ts   # esquemas compartidos
  infra/migrations/{010_identity.sql,011_customers.sql}
  scripts/identity/seed-admin.ts        # primer administrador, solo local
  tests/{unit,integration,e2e}/
```

## 5. Fases (alimentan `tasks.md`)

1. **Cimientos:** contratos, migraciones, cifrado de columnas, puerto de correo con Mailpit, límites en Redis.
2. **US1 (P1):** registro, confirmación, acceso, cierre de sesión, recuperación, límites y avisos.
3. **US2 (P1):** roles, invitación de personal, TOTP y códigos de recuperación, guards por rol, desactivación con corte de sesiones.
4. **US3 (P2):** perfil, cambio de correo y contraseña con reautenticación, historial (contrato).
5. **US4 (P2):** consentimientos, descarga, eliminación y anonimización, solicitudes de derechos.
6. **Transversal:** eventos de seguridad sin datos sensibles, accesibilidad AAA, E2E, inventario LOPDP.

## 6. Riesgos y decisiones abiertas

- **Jurisdicción LOPDP** sigue pendiente de confirmar (ROADMAP); el plazo de 15 días es un supuesto del spec.
- **Contraseñas filtradas:** la consulta externa (HIBP, k-anonimato) no es verificable de forma fiable en local; se diseña un puerto con lista local de contraseñas comunes y adaptador HIBP opcional (research D-05).
- **Pedidos aún no existen:** historial y anonimización se prueban con un doble del puerto `PedidosPorCliente`; la prueba real queda pendiente del Spec #6.
- **CAPTCHA:** el diagrama lo menciona y el spec no lo exige; no se añade, los límites por IP y cuenta cubren FR-005 (a confirmar con el equipo).
- **Producción:** el primer administrador y la gestión de claves PII en un gestor real no son evaluables en local.
