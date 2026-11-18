# T017 — infraestructura local real: degradación, recuperación, reinicio y persistencia técnica

2026-11-17/18, Windows 11, rama feature/spec-1 (antes feature/spec-1-continuacion), base 49ab2f0. Node 24.22.1, pnpm 12.21.0, Docker Desktop Linux 29.8.0. Origin fetch/push: fork Nicolay404. Autor local; el clon limpio independiente es T022.

## Qué cubre cada suite (Testcontainers con Postgres, Redis y RabbitMQ reales, puertos dinámicos)

| Requisito de T017 | Prueba | Resultado |
|---|---|---|
| Degradación | `health.int.spec.ts`: cada dependencia sin respuesta da 503 en ≤3 s, liveness sigue en 200 y sin secretos; las tres caídas a la vez también en ≤3 s | Pasa |
| Recuperación | Misma suite: al reanudar la dependencia, readiness vuelve a 200. `infrastructure.int.spec.ts`: pausa, reanudación y reinicio de cada servicio | Pasa |
| Reinicio | `infrastructure.int.spec.ts` reinicia cada contenedor y reconecta con su endpoint recalculado; `worker.int.spec.ts` y `bootstrap.int.spec.ts` cubren arranque, cierre y segundo arranque de worker/dev | Pasa |
| Persistencia técnica | `persistence.int.spec.ts` (nuevo): fila técnica de Postgres y mensaje persistente de cola durable RabbitMQ sobreviven al reinicio del contenedor | Pasa |
| Recuperación del worker | `persistence.int.spec.ts` (nuevo): con RabbitMQ pausado el worker no termina ni emite señal; al volver, el siguiente sondeo restablece el heartbeat sin reiniciar el proceso, y el cierre lo borra | Pasa |

`persistence.int.spec.ts` describe comportamiento ya implementado (T010–T012), por lo que pasó en su primera ejecución válida; no hubo rojo previo ni se presenta como TDD. Una primera ejecución falló solo porque el repositorio se había cambiado a `main` por accidente (sin `allowBuilds`) y después por Docker detenido; ambas causas ajenas al código y corregidas.

Nada escribe tablas, colas ni claves de negocio: las tablas y colas de prueba usan nombres únicos, se eliminan al final y los contenedores se destruyen con sus volúmenes.

## Defecto encontrado y corregido: saludo SMTP de Mailpit con DNS lento

Al repetir la suite completa, `bootstrap.int.spec.ts` (T015) empezó a fallar con «Infraestructura no disponible: mailpit», aunque había pasado antes.

- Diagnóstico: el endpoint HTTP `/readyz` respondía 200, pero el saludo `220` de SMTP tardaba **10 016 ms** (el sondeo de `infra:check` espera menos). Mailpit hace una resolución DNS inversa del cliente al aceptar la conexión y el DNS del contenedor respondía lento en ese momento.
- Con `MP_SMTP_DISABLE_RDNS=true` el mismo saludo llegó en **11 ms** (medido en un contenedor Mailpit aislado).
- Corrección: `MP_SMTP_DISABLE_RDNS: 'true'` en `proyecto/infra/compose.yaml` y en el contenedor Mailpit de `bootstrap.int.spec.ts`. Es un ajuste de entorno local; no afecta al código de aplicación.
- Verificación: `docker compose ... config` válido; `up -d --wait` con los cuatro servicios sanos; `pnpm infra:check --env-file .env.example` con OK postgres/redis/rabbitmq/mailpit y salida 0; `down` sin `-v`; `bootstrap.int.spec.ts` 5/5.

## Comandos y resultados (cwd proyecto/)

| Comando | Resultado |
|---|---|
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | 0, 0, 0 |
| `pnpm test:integration --runTestsByPath tests/integration/persistence.int.spec.ts` | 3/3, 40,7 s |
| `pnpm test:integration` (suite completa) | 6 suites, 27/27, 126,9 s |

Límites: ejecución en la máquina del autor, sin cloud. La recuperación de las pruebas con Redis no afirma persistencia en disco de Redis (se usa como caché/sesión; no se le atribuye durabilidad). Flags runtime y migraciones llegan en T050–T054.
