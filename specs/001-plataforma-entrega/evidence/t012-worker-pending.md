# T012 — worker técnico verificado

## Historial previo a la verificación final

2026-11-17. Base publicada 792452d en feature/spec-1-continuacion. El usuario envió después una instrucción que vuelve a asignar feature/spec-1 y prohíbe merge. Se conservan los cambios locales y se solicita resolver esa diferencia de rama antes de publicar o continuar. No hay cambio/stash automático de ramas ni merge.

Archivos del bloque: proyecto/apps/worker/package.json, proyecto/pnpm-lock.yaml, proyecto/apps/worker/src/main.ts, proyecto/apps/worker/src/platform-probe.ts y proyecto/tests/integration/worker.int.spec.ts. Redis/amqplib declarados runtime con versiones ya fijadas; ningún dominio nuevo.

- Prueba inicial roja: Jest no podía resolver platform-probe, que aún no existía.
- Después de implementar, pnpm test:integration --runTestsByPath tests/integration/worker.int.spec.ts: 2/2 pasan con Testcontainers reales, 13.898s.
- Primer caso: publicación AMQP confirmada/consumo/ack correlacionados en cola exclusiva, sin segundo mensaje; señal Redis privada con versión, timestamp y TTL <=30s.
- Segundo caso: inicio del coordinador y stop eliminan heartbeat y temporizador; conexiones de cada sondeo cierran en finally.
- pnpm typecheck detectó inferencia UUID demasiado estrecha para instanceId de prueba; se anotó string explícito, y la repetición pasó raíz y cinco paquetes con fuentes.
- pnpm lint, pnpm format:check y pnpm test:config (11/11) pasaron.
- No se ha verificado todavía el entrypoint main del worker mediante arranque del monorepo, señal de SO en Windows ni el conjunto completo de integración tras añadir worker. T012 conserva casilla pendiente por ahora; no confundir sus dos tests con H0 completo.

Git fetch origin pasó; origin es el fork Nicolay404 tanto fetch como push; HEAD y origin/feature/spec-1-continuacion 0/0. Ultimo commit 792452d. El árbol tiene exclusivamente el bloque worker y esta evidencia sin publicar. No se tocó la rama anterior ni .env privados. T013 y posteriores no se iniciaron.

## Verificación final y autorización de publicación

El usuario confirmó feature/spec-1-continuacion y PR #2, sin traslado ni merge. Esta sección supera el bloqueo histórico anterior. Se mantiene `instanceId: string = randomUUID()` en la versión final de platform-probe.ts.

Se añadió un tercer caso: arranque real de apps/worker/src/main.ts con configuración explícita de decoradores, heartbeat con versión worker-process-test, ejecución del manejador SIGTERM y salida natural 0; heartbeat eliminado. En Windows se emite SIGTERM dentro del hijo mediante un wrapper IPC exclusivamente del test, sin modificar el producto para pruebas ni usar kill() como prueba falsa de cierre. El canal IPC del arnés se desconecta antes de esperar salida.

Sobre esta versión final: pnpm typecheck 0; pnpm lint 0; pnpm format:check 0; pnpm test:config 11/11; pnpm install --frozen-lockfile --ignore-scripts 0; pnpm test:integration 15/15 en tres suites, 86.331s. Se verifican tanto el caso explícito de instanceId de prueba como el UUID por defecto del proceso real. No hay puerto público ni lógica de pedidos/pagos. T012 completada; el arranque coordinado del monorepo y H0 se verificarán en tareas posteriores, no se atribuyen a esta prueba.
