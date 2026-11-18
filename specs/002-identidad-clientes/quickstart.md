# Quickstart — Spec #2 (local)

Requisitos: Docker, pnpm y Node del `.node-version`. Todo se ejecuta desde `proyecto/`.

1. `pnpm install` y copiar `.env.example` a `.env` (claves `PII_KEY_1`, `PII_INDEX_KEY` y `SESSION_PEPPER` de prueba incluidas en `.env.example`; nunca usarlas fuera de local).
2. `pnpm infra:up` (Postgres, Redis, RabbitMQ y Mailpit) y `pnpm db:migrate`.
3. `pnpm flags:set identidad-habilitada on` y `pnpm identity:seed-admin` (crea el primer administrador; se niega en producción).
4. `pnpm dev`; los correos se leen en Mailpit (`http://127.0.0.1:8025`).

## Recorridos de aceptación

- **US1:** registrarse → abrir el correo de confirmación en Mailpit → iniciar sesión → cerrar sesión → recuperar contraseña (enlace de 30 min, un solo uso). Repetir con teclado y lector de pantalla.
- **US2:** como administrador crear personal → abrir la invitación → configurar TOTP → comprobar que `/admin/*` devuelve 403 y deja evento.
- **US3:** editar perfil, cambiar correo (confirmar el nuevo, el anterior recibe aviso) y abrir el historial (vacío hasta el Spec #6).
- **US4:** descargar la exportación, retirar un consentimiento y eliminar la cuenta; después no se puede iniciar sesión y ningún dato personal aparece en la exportación ni en búsquedas.

## Verificación

`pnpm test:unit`, `pnpm test:integration` (Testcontainers), `pnpm test:e2e` (Playwright + axe). No evaluable en local: HIBP real, gestor de claves y despliegue.
