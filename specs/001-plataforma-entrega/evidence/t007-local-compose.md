# T007 — Infraestructura local verificada

Fecha: 2026-11-17. Windows PowerShell, Docker Desktop con motor Linux. Base: c5f705772b3f06f502147fb5f8e6b0377190eb5a; rama `feature/spec-1-continuacion`. Es un ensayo local del autor, no la reproducción independiente de T022 ni aceptación de cloud.

## Condiciones de Git

`git fetch origin` pasó. Fetch/push de origin apuntan a `https://github.com/Nicolay404/cafeteriaArquitecturaSW.git`. Árbol inicialmente limpio; `git diff --stat origin/main origin/feature/spec-1` sin salida. `git switch main` y `git pull --ff-only origin main` pasaron (actualizado). La rama de continuación no existía y se creó desde main. No se hizo merge, rebase, borrado ni force push de la rama anterior.

## Diagnóstico y verificaciones

Todos los comandos de Compose se ejecutaron desde `proyecto/`, con `--env-file .env.example -f infra/compose.yaml`. No se creó `.env` ni se instaló Docker/Jest/Testcontainers.

| Comando / ensayo | Resultado observado |
|---|---|
| `docker --version` | Docker 29.8.0, build 88096ef |
| `docker compose version` | Compose v5.5.1 |
| `docker info` inicial | Error: pipe desktopLinuxEngine ausente; CLI/Compose presentes, motor detenido |
| `docker desktop start --timeout 45` | Salida 0, inició Desktop instalado |
| `docker info --format '{{.OSType}} {{.ServerVersion}}'` | linux 29.8.0 |
| `docker compose ... config --quiet` | Salida 0 |
| `docker compose ... up -d --wait --wait-timeout 150`, puerto predeterminado | Falló: Windows no permitió bind 5432; Get-NetTCPConnection mostró listener de otro proceso en 5432 |
| `$env:POSTGRES_PORT='55432'`, repetir `up ...` | Salida 0, cuatro servicios healthy; todos los puertos publicados en 127.0.0.1 |
| `docker compose ... exec -T postgres psql -U cafeteria_local -d cafeteria_local -tAc 'SELECT 1'` | Salida 0, 1 |
| `docker compose ... exec -T redis redis-cli ping` | Salida 0, PONG |
| `docker compose ... exec -T rabbitmq rabbitmqctl list_vhosts name` | Salida 0, cafeteria_local |
| GET `http://127.0.0.1:8025/readyz` | HTTP 200 |
| `docker compose ... down`, repetir `up ... --wait` | Ambos salida 0; segundo arranque con los mismos volúmenes y cuatro servicios healthy |
| Parada final `docker compose ... down` | Salida 0; volúmenes conservados, no contenedores de este ensayo activos |
| `pnpm typecheck` | Salida 0, raíz y cinco paquetes con fuentes |
| `pnpm lint` | Salida 0 |
| `pnpm format:check` | Inicialmente falló por CRLF del checkout; tras normalizar LF y regla .gitattributes para proyecto/, salida 0 sin cambios semánticos en fuentes |
| `pnpm exec prettier --check infra/compose.yaml` | Salida 0 después de formato |
| `pnpm test:config` | Salida 0, 11/11 tests |
| `node --env-file=.env.example --import tsx scripts/env-check.ts` | Salida 0, API/worker/web válidos |
| Resolución Node de jest/testcontainers/@testcontainers/postgresql | NO DISPONIBLE; T009/T010 pendientes, sin instalación por restricción del usuario |

Los comandos pnpm se invocaron con `corepack.cmd`, cache y shims temporales ya existentes según decisions/runtime.md. No se modificó PATH persistente ni ExecutionPolicy. Se fijó `POSTGRES_PORT=55432` en el proceso de verificación, sin modificar secretos ni proceso ajeno. No se ejecutó reinstalación/build/E2E ni se atribuye aprobación AAA a esta prueba.

## Imágenes

Digests obtenidos mediante GET público al endpoint `https://hub.docker.com/v2/repositories/<repositorio>/tags/<tag>` y descargados por Docker con éxito. Se conservan tag exacto y digest en Compose. Postgres 17 mantiene `/var/lib/postgresql/data`; Redis usa AOF; RabbitMQ usa hostname estable para su volumen; Mailpit almacena base local en volumen. Las credenciales de .env.example solo son de prueba local.

- library/postgres:17.12-bookworm — sha256:40865bc877a289da75963d97d72b59633f639fc5af7a4e856bfa3714cae5b536
- library/redis:8.8.4-alpine — sha256:1273af45b299d2b8b60d0e400d90aa6c2c5b1794f01d6a7ca60ff3ba6e65efb5
- library/rabbitmq:4.4.0-management-alpine — sha256:4841f6384ef8313c3594cd3f2e9f40c10805f8a61c45f08a9a5d9ddea8199267
- axllent/mailpit:v1.33.1 — sha256:aef2aacc11f075ec0fb6874275ee4a421e688e11a96ebb296134d1735c7761ce

Pendiente: T009/T010 requieren herramientas Jest/Testcontainers no disponibles. Tras autorizar e incorporar dependencias de desarrollo exactas, escribir pruebas primero, demostrar rojo y seguir T011 según el grafo. No hay pruebas de publish/consume ni recuperación de aplicación: corresponden a tareas posteriores. Aprobación visual del equipo y accesos cloud mantienen sus puertas originales.
