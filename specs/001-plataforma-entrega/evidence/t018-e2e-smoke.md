# T018 — E2E y smoke del inicio básico

2026-11-18, Windows 11, rama feature/spec-1, base 1ec1660. Node 24.22.1, pnpm 12.21.0, Docker Desktop Linux 29.8.0, Chromium de Playwright 1.64.1. Autor local; sin cloud ni diseño final. El clon limpio independiente es T022.

## Alcance

El E2E arranca `pnpm dev` (web 3000, API 3001, worker) contra Compose local, espera el proxy `/api/health` y prueba solo lo que existe: el inicio básico de T013 y su conexión con la API por el proxy de T014. No requiere diseño ni material aprobado.

| Área | Comprobación | Resultado |
|---|---|---|
| Semántica | `lang="es"`, título «Cafetería», un único h1, landmark `main`, texto veraz | Pasa |
| Sin flujos inexistentes | Sin form/button/input/select/textarea/img/video ni enlaces dentro de `main`; solo el enlace de salto | Pasa |
| Teclado/foco | Primer Tab enfoca «Saltar al contenido», visible, ≥44 px de alto y con contorno; Enter lleva el foco a `#contenido` | Pasa |
| Movimiento reducido | Con `prefers-reduced-motion: reduce` el contenido sigue visible | Pasa |
| Reflow | A 320 px no hay desplazamiento horizontal | Pasa |
| axe | Etiquetas wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa, wcag2aaa y best-practice: 0 violaciones, con más de 10 reglas evaluadas | Pasa |
| Web → API | `/api/health` por la web es idéntico a `/health` de la API (200, `status: ok`, versión), con `no-store` | Pasa |
| Higiene | La respuesta de la web no contiene postgres, redis, rabbit, credenciales ni URLs internas | Pasa |
| Smoke | Contra API y web compiladas (`next start` y `node dist`): página inicial, proxy con versión y sin caché, API live/ready con la misma versión que ve la web | 3/3 |

## Comandos (cwd proyecto/)

| Comando | Resultado |
|---|---|
| `pnpm add -D -w --save-exact @axe-core/playwright@4.14.0`, `pnpm install --frozen-lockfile` | 0 |
| `pnpm exec playwright install chromium` | 0 (descarga pública al caché del usuario, fuera del repo) |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | 0, 0, 0 |
| `E2E_ENV_FILE=.env.example pnpm test:e2e` (con Compose y POSTGRES_PORT=55432, 5432 ocupado por un proceso ajeno) | 8 passed, 7,6 s |
| `pnpm build`, API y web compiladas, `pnpm test:smoke` con SMOKE_WEB_URL y SMOKE_API_URL | 3 passed; 0 listeners en 3000/3001 al terminar |

## Rojos, correcciones y salvaguardas

- Las pruebas describen comportamiento ya implementado (T013/T014), así que no hubo rojo previo ni se presenta como TDD.
- Primera ejecución: 1 fallo de la prueba, no de la página. Next en modo dev inyecta un botón del overlay de desarrollo dentro de un shadow DOM y la comprobación «sin botones» lo contaba. Se acotó la comprobación a `main` y a los hijos directos de `body`. También se corrigió un error de tipos (`document` sin lib DOM) evaluando una expresión de texto.
- Se verificó que axe no devuelve siempre «ok»: con una prueba temporal (no commiteada) sobre HTML con imagen sin alt, sin título, sin idioma y texto gris claro, detectó `color-contrast`, `document-title`, `html-has-lang` e `image-alt`.

## Límites

axe sin violaciones **no demuestra WCAG AAA**. Siguen pendientes lector de pantalla (NVDA/VoiceOver), ampliación de texto, contraste medido por estados y revisión humana del boceto: T039–T040 y T083. No hay E2E del backend en preview ni CI; eso es de US1/US2.
