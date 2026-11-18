# US1 — pantallas de cuenta y recorrido en el navegador (T021, T022)

2026-11-18 · rama `feature/spec-2` (sobre `main` con los PR #14, #15 y #16) · Windows 11, Docker Desktop, Chromium de Playwright. Infraestructura real: Postgres 17, Redis 8, RabbitMQ 4 y Mailpit (Compose local, `pnpm dev`).

## Qué se construyó

| Pieza | Dónde |
|---|---|
| Pantallas `/registro`, `/confirmar`, `/acceso`, `/recuperar`, `/restablecer` y `/cuenta` (punto de llegada con cierre de sesión) | `proyecto/apps/web/src/app/(cuenta)/` |
| Puente same-origin web → API: lista cerrada de 8 rutas con su método, destino fijo (la API configurada), sin redirecciones, límite de 10 kB; reenvía cookie, CSRF, agente e IP del visitante | `proyecto/apps/web/src/server/auth-proxy.ts` |
| La API lee la IP de `X-Forwarded-For` solo si llega de una red privada | `proyecto/apps/api/src/composition/app.ts` |
| Casilla accesible y estilos del paquete UI | `proyecto/packages/ui/` |
| Entrada `@cafeteria/contracts/cuenta` apta para el navegador (Next no resuelve los `.js` de los demás contratos) | `proyecto/packages/contracts/src/cuenta.ts` |

Decisiones con motivo: la confirmación del correo se hace **al pulsar un botón**, no al abrir el enlace, para que los antivirus y las vistas previas de correo no gasten el enlace de un solo uso; las páginas con token llevan `referrer: no-referrer` y `noindex`; la validación en el navegador usa los mismos esquemas que la API, así los mensajes son idénticos.

## Resultado

- `pnpm exec playwright test`: **17 pasan** (8 del inicio base y 9 de US1), en 23 s y sin reintentos.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check` sin errores; `next build` compila las 6 pantallas.
- Integración: 17 pruebas de US1 por HTTP (incluida la de `X-Forwarded-For`) pasan con servicios reales.

Qué comprueban los 9 recorridos de US1:

- Registro → correo en Mailpit → confirmar → entrar → «Hola, Ana Pérez» → cerrar sesión → `/cuenta` dice «Tu sesión terminó».
- Formulario vacío: el foco va al **resumen de errores**, que cuenta «Hay 4 errores» y enlaza a cada campo; cada campo marca `aria-invalid` y su error propio.
- **Solo con teclado:** registro (con la casilla por Espacio), confirmación y acceso completos.
- Sin confirmar no se entra y se ofrece un enlace nuevo; cuenta inexistente y contraseña incorrecta muestran **exactamente el mismo texto**.
- Recuperación: contraseña débil («Password1234») se rechaza **sin gastar el enlace**; la buena cambia la contraseña; reusar el enlace dice «Este enlace no sirve» y ofrece pedir uno nuevo.
- Enlace de confirmación inventado: explica qué hacer y ofrece reenvío.
- **axe** sobre las cuatro pantallas y sobre el registro con errores, con las etiquetas WCAG 2 A/AA, 2.1, 2.2 AA, **AAA** y buenas prácticas (incluye `color-contrast-enhanced`, 7:1): 0 violaciones.
- Objetivos de 44 px o más en campos y botones; anillo de foco visible; con `prefers-reduced-motion` el botón no se mueve.

## Límites, sin maquillar

- **T023 sigue abierta:** axe automático **no demuestra** WCAG AAA. Falta la prueba manual con lector de pantalla (NVDA) y la revisión humana de los cuatro flujos.
- Solo se probó **Chromium** y en pantalla de escritorio (más el reflow base de la página de inicio); no Firefox, Safari ni móvil real.
- La dirección visual y **todos los textos son borradores** pendientes de aprobación del equipo (T045; `decisions/visual-direction.md`).
- **Nada enlaza todavía a estas pantallas:** la página de inicio no tiene enlaces (su prueba E2E exige que no los tenga hasta que exista el diseño). Se entra por la URL.
- Si la cuenta requiere segundo factor (personal y administradores), el acceso muestra que esa pantalla aún no existe (US2, T029).
- **Staging local actualizado:** candidato `cand-bc54c072ff8a` liberado a staging con `pnpm release` (migraciones 001, 010 y 011; smoke correcto). El staging ahora trae sus claves de ensayo (distintas de las de `.env.example`, que la API rechaza fuera de local) y su propio Mailpit en http://127.0.0.1:53100. Comprobado: `/registro`, `/acceso` y `/cuenta` responden 200 en http://127.0.0.1:5100, y un registro por el puente web devuelve 202 y deja el correo «Confirma tu correo» en Mailpit. No se repitió el E2E de Playwright contra el staging.
- **Hallazgo al empaquetar:** la primera construcción de la imagen de la API falló porque un import `.ts` de los contratos no se puede emitir con `tsc`. Las comprobaciones por commit no lo veían porque la API no declaraba a los contratos como dependencia; se corrigió con `rewriteRelativeImportExtensions` y declarando la dependencia, de modo que Turbo reconstruya la API cuando cambien los contratos.
- Los límites por IP (5 registros por hora) persisten entre ejecuciones; el E2E los limpia en Redis, solo en local.
- Hallazgo: en este Windows el puerto 5432 está reservado y Postgres no arrancó con el Compose por defecto; se usó `POSTGRES_PORT=55432` en un `.env` local (ignorado por git).
