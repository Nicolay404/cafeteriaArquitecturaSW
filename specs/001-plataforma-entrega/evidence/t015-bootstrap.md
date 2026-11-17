# T015 — arranque coordinado e infra-check

2026-11-17, Windows PowerShell, base b8361be, feature/spec-1-continuacion. Origin fetch/push sigue siendo el fork Nicolay404; árbol limpio al inicio. Se conservan proyecto/, docs/skills en raíz y los artefactos T012–T014 publicados.

## Implementación

Scripts locales cargan el archivo explícito o .env por defecto y validan una sola configuración compartida de API/worker/web. El entorno del proceso prevalece. El validador env:check también recibe esa configuración compartida, para que web no dependa de lectura automática de dotenv dentro de Next.

Se promueven a proyecto/scripts/infrastructure-probes.ts las sondas que ya usaban los tests, que ahora reexportan el mismo código. No se reimplementan los módulos de dominio. Infra-check ejecuta cuatro sondas independientes y reporta OK/ERROR por servicio; error implica salida 1 y no imprime drivers/URLs/credenciales. Se limita a APP_ENV=local y hosts loopback antes de escribir datos de prueba. Redis usa clave UUID con TTL y borrado; Rabbit usa cola exclusiva/autodelete y confirma consumo correlacionado sin duplicado; Postgres no crea tablas. Mailpit comprueba readyz y diálogo SMTP 220/QUIT/221, sin enviar correo real.

Dev valida puertos y pares de URLs, comprueba infraestructura y arranca API/worker/web con configuración de tsx por paquete. Next dev usa su API pública de servidor; no se arrastra --env-file a sus workers. IPC privado solo lleva shutdown; cierre y desconexión del supervisor notifican a sus propios hijos. Señales y cancelación no requieren matar procesos ajenos. La reserva de puerto y timeouts fallan con nombre, sin datos secretos. Turbo dev es persistente/no cacheable; el supervisor Node gestiona el ciclo de vida multiplataforma.

## Flujo manual ejecutado desde proyecto/

Node 24.22.1, pnpm 12.21.0, Docker Linux 29.8.0. Se usó Corepack y shims temporales existentes; ninguna instalación global. .env privado no existe y no se creó.

1. Get-NetTCPConnection confirmó listener 5432 propiedad de otro proceso, PID 9176; 3000/3001/55432 estaban libres. No se detuvo ese proceso.
2. `$env:POSTGRES_PORT='55432'`; `$env:DATABASE_URL='postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:55432/cafeteria_local'`. Son credenciales públicas solo de .env.example; no reutilizar en cloud. Overrides solo en esta terminal.
3. `docker compose --env-file .env.example -f infra/compose.yaml up -d --wait --wait-timeout 150`: 0. Cuatro servicios healthy, todos en 127.0.0.1: Postgres 55432, Redis 6379, Rabbit 5672/15672, Mailpit 1025/8025. Se usan imágenes/volúmenes existentes de T007; no se modificó Compose.
4. `corepack.cmd pnpm env:check --env-file .env.example`: 0, Configuración válida: API, worker y web.
5. `corepack.cmd pnpm infra:check --env-file .env.example`: 0, OK postgres / OK redis / OK rabbitmq / OK mailpit.
6. `corepack.cmd pnpm dev --env-file .env.example`: worker_ready y DEV_READY web/API/worker; página Next 200. API /health y /health/live 200 con status ok/version local; proxy web /api/health 200 con el mismo JSON y no-store; Mailpit /readyz 200. Redis GET del heartbeat de esta instancia devolvió versión local/timestamp, sin PII.
7. En otro proceso, con REDIS_URL=redis://127.0.0.1:1, `pnpm infra:check --env-file .env.example`: OK postgres, ERROR redis, OK rabbitmq, OK mailpit; salida 1. No se apagó Redis ajeno ni se alteró el entorno de dev activo.
8. Ctrl+C cierra los hijos propios. Se comprobó ausencia de listeners 3000/3001 y EXISTS heartbeat=0. El wrapper Windows .cmd pidió Terminate batch job: Y y devolvió 1 por interrupción; no se presenta como salida normal 0 del coordinador.
9. Se repitió pnpm dev con los mismos overrides: segundo DEV_READY, sin colisión; se detuvo de igual forma y se ejecutó compose down sin -v, salida 0, conservando volúmenes.

## Automatización y calidad

- Rojo inicial del nuevo bootstrap.int.spec.ts: faltaban infra-check/dev, antes de implementar.
- Testcontainers Postgres/Redis/RabbitMQ/Mailpit aislados, puertos dinámicos: SQL/Redis/Rabbit/HTTP+SMTP, Redis pausado con comprobación del CLI (salida 1, sin password), arranque y proxy 200 con procesos reales, stop y liberación explícita de ambos puertos, rechazo de puerto ocupado. Se incorpora además caso de cancelación solicitada antes de arrancar.
- Suite completa de integración: 23/23, 5 suites, 85.253s, antes de añadir únicamente el caso de cancelación del test; código productivo final ya incluido salvo env-check, comprobado por su propia suite posterior.
- pnpm typecheck/lint/format:check: aprobados; pnpm test:config: 12/12 tras el ajuste de carga compartida; Vitest web: 9/9. No se atribuye cobertura/Sonar/E2E a esos resultados.

Esta evidencia prueba T015 en la instalación del autor. No certifica clon limpio independiente T022, persistencia avanzada T017, E2E T018, UI final, CI, despliegues o métricas externas. PR #2 debe continuar en borrador mientras el spec esté incompleto; solo se habilitará para revisión cuando todos sus requisitos estén verificados, sin merge.

Verificación final del nuevo caso: bootstrap.int.spec.ts 5/5, 24.341s, incluido cancelación; sin procesos dev/process-entry restantes ni .env privado creado.
