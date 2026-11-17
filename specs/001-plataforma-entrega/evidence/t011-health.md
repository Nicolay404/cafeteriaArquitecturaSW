# T009–T011 — contrato de salud en verde

2026-11-17. Rama feature/spec-1-continuacion, base 001c399. Windows/Node 24.22.1/pnpm 12.21.0/Docker Linux 29.8.0. Cambios locales T009/T010 preservados. Ningún dominio de negocio implementado.

API Nest: GET /health devuelve exactamente status/version, 200 o 503, JSON y Cache-Control no-store. PostgreSQL SELECT 1, Redis PING y handshake AMQP concurrentes, con conexiones temporales y timeouts acotados. No escribe claves, tablas ni colas. Errores solo registran nombre de dependencia/evento, nunca error del driver con URL. GET /health/live responde sin contactar servicios. El proceso continúa ante degradación y recupera readiness al reanudar dependencias.

Comandos desde proyecto/, con corepack.cmd pnpm y shims temporales existentes:

| Comando | Resultado |
|---|---|
| pnpm test:integration --runTestsByPath tests/integration/health.int.spec.ts | 6/6 pasan contra proceso API real; cada dependencia pausada y las tres simultáneas: 503 en <=3s, liveness 200; recuperación 200 |
| pnpm test:integration | 12/12 pasan, 2 suites, 51.431s; incluye los seis casos T010 |
| pnpm typecheck | 0, raíz y cinco paquetes con fuentes |
| pnpm lint / pnpm format:check | 0 / 0 |
| pnpm test:config | 11/11 |
| pnpm install --frozen-lockfile --ignore-scripts | 0, siete proyectos y política de suministro aprobada |

Durante ejecución se observó un arranque RabbitMQ unhealthy; el fixture ahora limita schedulers Erlang y añade 15s de gracia, manteniendo check_running/check_port_connectivity y los casos de caída. No se presenta una causa raíz concluyente. El primer inicio API falló porque tsx no leía la configuración de decoradores del paquete desde cwd proyecto; el arnés ahora usa TSX_TSCONFIG_PATH explícito hacia apps/api/tsconfig.json. No se relajaron aserciones ni se omitieron pruebas.

pg/redis/amqplib pasan a ser dependencias runtime declaradas también en apps/api; @types/pg es de desarrollo. Versiones ya seleccionadas/verificadas en matriz, sin nuevas herramientas globales. El registro T009–T010 anterior describe el rojo histórico; esta ejecución lo supera. Sin secretos, .env privados o cachés agregados. H0, worker/web, aprobación visual, CI/Sonar/cloud/métricas todavía pendientes.
