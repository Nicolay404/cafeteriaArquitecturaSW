# Verificación desde clon limpio — Spec #1

**Estado:** T001–T021 verificadas bajo `proyecto/`: configuración, Compose local, API de salud, worker técnico, inicio básico y proxy web runtime. Build web y suites locales probados; ver evidence/t011-health.md, evidence/t012-worker-pending.md y evidence/t013-t014-web.md. El arranque coordinado y infra:check de T015 están disponibles; E2E y cloud del flujo completo siguiente siguen pendientes. No desplegar desde equipos personales ni interpretar la base funcional como diseño final aprobado.

## Prerrequisitos y configuración

Git, Docker con contenedores Linux/Compose y motor iniciado, Node y pnpm en las versiones exactas registradas por el bootstrap en `proyecto/.node-version`/`packageManager`. Una compañera comprobará instalación desde cero en Windows PowerShell con Docker Desktop o Linux. Descargar herramientas/imágenes necesita red pública; los ensayos locales no requieren cuentas Vercel/Render/Sonar/Grafana ni secretos externos. Verificar `node --version`, `pnpm --version`, `docker version`, `docker compose version` contra la matriz versionada. No aceptar bootstrap sin versiones/digests fijados y lockfile reproducible.

Ejecutar en una carpeta nueva, manteniendo la rama asignada:

```powershell
git clone --branch feature/spec-1-continuacion --single-branch https://github.com/Nicolay404/cafeteriaArquitecturaSW.git cafeteria-verificacion
Set-Location cafeteria-verificacion
git branch --show-current
Test-Path specs/001-plataforma-entrega/spec.md
Set-Location proyecto
Copy-Item .env.example .env
pnpm install --frozen-lockfile
pnpm env:check
docker compose --env-file .env -f infra/compose.yaml up -d --wait
pnpm infra:check
pnpm dev
```

No cambiar rama automáticamente si no coincide. El clone solo podrá verificar los artefactos cuando hayan sido implementados y publicados por el equipo; esta planificación no hace push. `pnpm dev` carga explícitamente `.env` y coordina web/API/worker; no asumir que Next/Nest encuentran un archivo raíz por sí solos.

Contenido de `proyecto/.env.example`, únicamente para servicios locales de prueba:

```dotenv
NODE_ENV=development
APP_ENV=local
APP_VERSION=local
WEB_PORT=3000
API_PORT=3001
API_BASE_URL=http://127.0.0.1:3001
WEB_ORIGIN=http://localhost:3000
POSTGRES_DB=cafeteria_local
POSTGRES_USER=cafeteria_local
POSTGRES_PASSWORD=solo_pruebas_locales
DATABASE_URL=postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:5432/cafeteria_local
REDIS_URL=redis://127.0.0.1:6379
RABBITMQ_DEFAULT_USER=cafeteria_local
RABBITMQ_DEFAULT_PASS=solo_pruebas_locales
RABBITMQ_DEFAULT_VHOST=cafeteria_local
RABBITMQ_URL=amqp://cafeteria_local:solo_pruebas_locales@127.0.0.1:5672/cafeteria_local
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
MAILPIT_UI_PORT=8025
FEATURE_FLAGS_PREFIX=cafeteria:local:flags
METRICS_EXPORT_ENABLED=false
```

No usar estos valores en cloud. `.env` ignorado por Git; Compose liga puertos a loopback. Redis sin autenticación solo dentro del entorno local aislado que habilitará Compose cuando se implemente. Si un puerto está ocupado, seguir el procedimiento documentado por implementación para cambiarlo junto con su URL; no terminar procesos ajenos. Secretos cloud solo en GitHub Environments/Vercel/Render, referencias sin valores en configuración versionada. Web recibe solo configuración pública; nunca DATABASE_URL/credenciales.

Variables cloud que se documentarán separadas: identidad del proyecto/organización y token CI Vercel; servicio/workspace y token CI Render; lectura/escritura GHCR con alcance mínimo; `SONAR_TOKEN`/organización/proyecto; URLs y tokens de Grafana/Mimir/Loki; credencial lectura GitHub para exportador; URLs privadas de datos y credenciales distintas por entorno; revisión de configuración y SHA de candidato. Habilitar exportación de métricas solo tras acceso y privacidad aprobados. No son requisitos del arranque local.

## Comprobar servicios

En otra terminal, desde proyecto/:

```powershell
docker compose --env-file .env -f infra/compose.yaml ps
Invoke-RestMethod http://localhost:3001/health
Invoke-RestMethod http://localhost:3001/health/live
Invoke-RestMethod http://localhost:3000/api/health
Invoke-WebRequest http://localhost:3000/
```

Esperado: cuatro dependencias sanas; API readiness/liveness 200, JSON conforme a `contracts/platform.md`; proxy refleja misma versión; web 200 con base semántica de T013; foto y diseño/textos finales aprobados siguen pendientes de T035–T040. `infra:check` hace SELECT técnico, write/read/delete Redis y publish/consume RabbitMQ con correlación, sin datos de negocio. El comando flags:set y su aceptación se implementarán en T050–T055; no ejecutarlo ni presentarlo disponible todavía.

Detener solo el servicio Redis de Compose en el entorno de prueba: readiness pasa a 503, liveness sigue 200 y flag falla seguro. Reiniciarlo y comprobar recuperación. Repetir integración para Postgres y RabbitMQ con timeout, sin reiniciar indefinidamente aplicación por dependencia caída. Worker consume mensaje técnico una vez conforme al identificador de prueba y registra señal de actividad sin PII. No basta con que el contenedor exista.

## Calidad local y accesibilidad

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm coverage:merge
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`test:e2e` arranca `pnpm dev` como webServer (con Compose ya levantado; `E2E_ENV_FILE=.env.example` usa ese archivo explícito). `test:smoke` no arranca nada y exige `SMOKE_WEB_URL` y `SMOKE_API_URL`. `coverage:merge` deja un único `coverage/lcov.info` a partir de los informes de unitarios e integración. E2E (8 pruebas: semántica, teclado/foco, movimiento reducido, reflow 320 px, axe y conexión web→API) y smoke (3 pruebas) existen desde T018; ver evidence/t018-e2e-smoke.md. Axe sin violaciones no demuestra AAA.

Esperado: salida 0, reportes y cobertura no vacía donde exista comportamiento. Testcontainers levanta Postgres/Redis/RabbitMQ reales con puertos propios y limpia sus recursos. Playwright verifica inicio, foto, ancla informativa y salud web→API, sin flujos futuros. Axe sin violaciones no demuestra AAA completa.

La segunda revisora recorre teclado/foco/skip link, contraste ≥7:1 medido en estados, objetivos ≥44×44, movimiento reducido, NVDA/VoiceOver, reflow y ampliación de texto. Capturas 320/390/768/1024/1440px y comparación con boceto aprobado. No aprobar foto sin licencia/texto alternativo adecuado ni controles hacia funciones inexistentes. Taste se consulta como checklist, sin imponer generación/diseño.

Parar procesos de desarrollo y dependencias sin borrar datos:

```powershell
docker compose --env-file .env -f infra/compose.yaml down
git status --short
```

Segundo arranque debe funcionar; lockfile no cambia. Una limpieza con eliminación de volúmenes solo se documentará para datos de prueba y se distinguirá de la parada normal.

## Verificaciones con accesos externos

No sustituirlas por simulaciones locales ni marcarlas realizadas:

| Ensayo | Acceso necesario | Aceptación |
|---|---|---|
| PR verde y PRs negativos, incluidos commits intermedios | Repo/rulesets/Actions/Sonar | SHA/causa visibles, merge bloqueado al fallar, checks ≤15min para ≤10 commits (SC-001–003) |
| Preview web/backend y main→staging | Vercel/Render/GHCR | Artefacto identificado y E2E/axe en preview; staging <20min, fallo conserva N−1 (SC-004/009) |
| Mismo artefacto por entorno | Configuración/proyectos/tokens CI | Hashes/digests iguales, URL API/secreto correctos, sin rebuild (FR-012) |
| Release sin aprobación y releases simultáneas | Environment production/revisores | No despliega sin aprobación; releases serializadas |
| Migración fallida/expand-contract | Pre-deploy y datos sintéticos | Backend anterior sigue atendiendo; N/N−1 compatibles y filas preservadas |
| Fallo smoke tras release | Operación autorizada y versiones previas | Web/API/worker restaurados <5min desde detección, sondeo sin interrupción y alerta (SC-005/006) |
| Revert al azar, incluido fixture migración | Copia desechable/CI/staging | Pasa controles y despliega; compensación con nueva migración (SC-007) |
| Dashboards/alertas/caída Grafana | Fuentes y grupos Grafana | Evento <1h, sin pérdida/duplicados, no ranking, cuenta sin permiso denegada (SC-008) |
| k6 nocturno y pre-festividades | Staging y scheduler | Solo rutas existentes; pedidos/menú figuran no evaluables todavía |

Cada ensayo queda en `evidence/README.md` con SHA/candidato, fecha, SO/versiones, comando/enlace ejecución, resultado esperado/real, responsable y bloqueos. No incluir secretos/datos personales. Si falta acceso, registrar cuál de `plan.md` §4 y dejar estado pendiente. No declarar SC-009 alcanzado hasta evidencia PR→staging y anotación de entrega; no contar staging como producción en DORA.


## Chequeos disponibles ahora y directorio de trabajo

Abrir Git y agentes desde la raíz del repositorio. Después entrar en proyecto/ para Node/Corepack/pnpm; no mover .env privados anteriores ni dependencias existentes. En una terminal nueva situada en raíz:

```powershell
Set-Location proyecto
corepack.cmd pnpm install --frozen-lockfile --ignore-scripts
corepack.cmd pnpm typecheck
corepack.cmd pnpm lint
corepack.cmd pnpm format:check
corepack.cmd pnpm test:config
node --env-file=.env.example --import tsx scripts/env-check.ts
```

En Linux usar corepack en vez de corepack.cmd. Node/pnpm fijados por archivos del workspace. Si pnpm no está en PATH, Turbo requiere shims Corepack temporales descritos en README.md; no cambiar políticas/globales. pnpm puede requerir red para metadatos de seguridad aunque paquetes están en cache. No desactivar políticas para forzar offline. Resultados actuales de migración en evidence/workspace-reorganization.md, no inferidos de estos comandos.

El bloque de arranque local ya está disponible: ejecutar desde proyecto/, donde está infra/compose.yaml (T007 verificada; consultar evidencia). Los scripts de aplicación van en proyecto/scripts/; los futuros scripts Git de historial/revert permanecen en scripts/ci/ desde raíz. .github/workflows/ se mantiene en raíz y deberá invocar trabajo de aplicación con cwd proyecto; rutas de checkout/cache empiezan proyecto/. Docker futuro contexto proyecto y despliegue apuntando proyecto/render.yaml, proyecto/vercel.json y proyecto/apps/web. Sin crear CI/Docker/cloud en esta reorganización.

## Compose disponible — T007

Desde `proyecto/`, sin crear ni modificar un `.env` privado:

```powershell
docker --version
docker compose version
docker info
docker compose --env-file .env.example -f infra/compose.yaml config --quiet
docker compose --env-file .env.example -f infra/compose.yaml up -d --wait --wait-timeout 150
docker compose --env-file .env.example -f infra/compose.yaml ps
docker compose --env-file .env.example -f infra/compose.yaml down
```

Se esperan Postgres, Redis, RabbitMQ y Mailpit sanos. `down` conserva los cuatro volúmenes; no usar `down -v` para una parada normal. Solo infraestructura: no demuestra API, web, integración Testcontainers o H0 completo. Las imágenes fijadas se descargan de repositorios públicos; no requiere secretos cloud.

Si el CLI no se encuentra, falta Docker en PATH/instalación; si solo falla `docker compose version`, falta el plugin Compose. Si ambas versiones funcionan pero `docker info` no conecta al pipe `dockerDesktopLinuxEngine`, abrir Docker Desktop en Windows e iniciar el motor Linux; resolver los requisitos de WSL/virtualización indicados por Desktop si los hubiera. No reinstalar ni cambiar permisos automáticamente.

En esta prueba el 5432 ya tenía un listener. Antes de `up`, se usó `$env:POSTGRES_PORT='55432'`; el contenedor sigue usando 5432 internamente. Al ejecutar aplicaciones futuras, ajustar también `DATABASE_URL` en su entorno a `postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:55432/cafeteria_local`. La variable de puerto solo afecta Compose, no reescribe la URL de la API. No detener procesos ajenos. En una nueva terminal sin override se mantiene el puerto 5432 del plan.

## Flujo T015 verificado sin crear .env privado

Git/agentes desde raíz, comandos de aplicación desde proyecto/. Se puede copiar .env.example a .env únicamente en un clon nuevo; los scripts dev e infra:check cargan .env por defecto y el proceso tiene precedencia. Para probar el ejemplo versionado directamente, usar --env-file:

```powershell
Set-Location proyecto
corepack.cmd pnpm env:check --env-file .env.example
$env:POSTGRES_PORT='55432'
$env:DATABASE_URL='postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:55432/cafeteria_local'
docker compose --env-file .env.example -f infra/compose.yaml up -d --wait --wait-timeout 150
corepack.cmd pnpm infra:check --env-file .env.example
corepack.cmd pnpm dev --env-file .env.example
```

55432 solo se usó porque el listener 5432 está ocupado en este Windows. No terminar procesos ajenos. Sin conflicto, omitir los dos overrides y usar 5432. No basta cambiar POSTGRES_PORT: DATABASE_URL debe concordar. API_BASE_URL/API_PORT y WEB_ORIGIN/WEB_PORT también deben coincidir; para otros puertos libres, ajustar ambos valores de cada par en el proceso o archivo local antes de dev. El coordinador rechaza puertos ocupados antes de iniciar hijos.

Se esperan OK postgres/redis/rabbitmq/mailpit, worker_ready y DEV_READY web/API/worker. API y web usan 3001/3000 si están libres. El supervisor pasa variables por env y configura tsx por paquete; Next no hereda un flag Node --env-file incompatible con sus workers. Turbo registra dev como persistente/no cacheable; el supervisor Node coordina procesos y cierre entre Windows/Linux. No arranca Docker automáticamente ni acepta APP_ENV cloud o URLs de datos/correo fuera de loopback.

En otra terminal comprobar / de web, /health y /health/live de API, /api/health de web y Mailpit /readyz. Infra-check verifica SELECT parametrizado, Redis escritura/lectura/eliminación, RabbitMQ confirm/correlación/ack/cola exclusiva vacía y Mailpit HTTP 200 + SMTP 220/QUIT/221. Ante fallo imprime ERROR con el nombre y termina con código 1, sin valores de configuración.

Detener dev con Ctrl+C: el supervisor cierra únicamente sus hijos; el worker elimina heartbeat y los puertos se liberan. En este Windows el wrapper .cmd de pnpm pregunta Terminate batch job (Y/N); responder Y. La terminal puede devolver código 1 por interrupción del batch, distinto del caso de error de infraestructura. Luego, desde proyecto/ con el mismo override de POSTGRES_PORT, ejecutar docker compose --env-file .env.example -f infra/compose.yaml down. No añadir -v: se conservan los volúmenes.

Ensayo y resultados precisos en [evidence/t015-bootstrap.md](evidence/t015-bootstrap.md). Es verificación del autor, no la revisión independiente desde clon limpio de T022. E2E, flags y diseño final mantienen sus tareas pendientes.
