# T020 — procedimiento de arranque local, comprobado

2026-11-18, Windows 11 (PowerShell 5.1, consola en inglés), rama feature/spec-1, base c3d6828. Node 24.22.1, pnpm 12.21.0, Docker Desktop Linux 29.8.0. Documento operativo en [README.md](../../../README.md); aquí quedan los comandos ejecutados y lo observado. Autor local; la repetición independiente es T022. Sin `.env` privado: se usó `.env.example` y overrides de proceso porque 5432 está ocupado por un proceso ajeno (PID 9176) que no se detuvo.

## Qué se comprobó, con resultado real

| # | Escenario | Comando (cwd proyecto/) | Observado |
|---|---|---|---|
| 1 | Sin `.env` ni `--env-file` | `pnpm env:check` | Salida 1: `Configuración inválida: NODE_ENV`. Nombra la variable, no imprime valores. |
| 2 | Variable ausente | `pnpm env:check --env-file <archivo sin REDIS_URL>` | Salida 1: `Configuración inválida: REDIS_URL`. |
| 3 | Puerto ocupado | listener propio en 127.0.0.1:3001 y `pnpm dev --env-file .env.example` | Salida 1: `Configuración inválida: API_PORT`; tras el fallo no queda ningún listener de la app en 3000/3001 y el listener ajeno no se toca. |
| 4 | Parada normal | `docker compose --env-file .env.example -f infra/compose.yaml down` | Salida 0. Los cuatro volúmenes `cafeteria-local_{postgres,redis,rabbitmq,mailpit}-data` siguen listados. |
| 5 | Infraestructura apagada | `pnpm infra:check --env-file .env.example` | `ERROR postgres/redis/rabbitmq/mailpit`, salida 1, sin credenciales ni URLs. |
| 6 | Segundo arranque | `docker compose ... up -d --wait --wait-timeout 150` | Salida 0 con los cuatro servicios sanos. |
| 7 | Persistencia real en Compose | Antes de 4 se creó una tabla técnica con una fila (`psql` dentro del contenedor). Después de 6 se leyó y se borró la tabla. | La fila `persiste` sobrevivió a `down` sin `-v` y al segundo `up`. |
| 8 | Verificación tras el segundo arranque | `pnpm infra:check --env-file .env.example` | `OK` en los cuatro, salida 0. |

Con POSTGRES_PORT=55432 y DATABASE_URL apuntando a ese puerto en esa terminal, para todos los casos anteriores.

## Arranque y parada de la aplicación

El arranque coordinado `pnpm dev`, los endpoints (`/health`, `/health/live`, `/api/health`), la página, el heartbeat privado del worker, el segundo arranque de `dev` y la parada con Ctrl+C ya se ejecutaron y están registrados en [t015-bootstrap.md](t015-bootstrap.md) (pasos 4–9), incluida la nota del wrapper `.cmd` de Windows (`Terminate batch job`, salida 1 por interrupción, hijos cerrados, puertos libres). En esta sesión se repitió la parte automatizable: `pnpm test:integration` 27/27 (que arranca web, API y worker reales y verifica su cierre) y `pnpm test:e2e` 8/8 con `pnpm dev` como servidor. No se simuló Ctrl+C interactivo de nuevo, porque no es automatizable desde esta herramienta.

## Documentado a partir de evidencia previa, no repetido hoy

- Mailpit con saludo SMTP lento por DNS inverso y su corrección (`MP_SMTP_DISABLE_RDNS`): [local-infrastructure.md](local-infrastructure.md).
- Instalación congelada desde un clon limpio y lockfile intacto: [local-quality.md](local-quality.md).
- Shims de Corepack temporales para Turbo: [decisions/runtime.md](../decisions/runtime.md).

## Límites

Procedimiento verificado por quien lo escribe y solo en Windows. No se probó en Linux ni macOS (los comandos de la guía están pensados para funcionar con `corepack` sin `.cmd`, pero no se ha comprobado). El `docker desktop start` es específico de Docker Desktop. El caso de "puerto ocupado" se provocó con el 3001; el flujo del 5432 se documenta con el override de T015. T022 debe repetir la guía en otra máquina y registrar las diferencias.
