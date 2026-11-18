# T016 — scripts de calidad, cobertura LCOV y configuración Playwright

2026-11-17, Windows 11, PowerShell 5.1, base 454a676 (T015 publicada), rama feature/spec-1-continuacion. Origin fetch/push: fork Nicolay404. Node 24.22.1, pnpm 12.21.0 (Corepack y shims en Temp, sin instalación global), Docker Desktop Linux 29.8.0. Sin .env privado: se usó .env.example y overrides de proceso POSTGRES_PORT=55432/DATABASE_URL porque 5432 sigue ocupado por un proceso ajeno (PID 9176), que no se detuvo.

## Cambios

| Área | Decisión |
|---|---|
| Dependencias nuevas | `@vitest/coverage-v8@5.1.0` (peer exacto de Vitest 5.1.0) y `@playwright/test@1.64.1` (publicada 2026-10-14; se descartó 1.65.x por recién publicada). Axe se incorporará en T018, cuando haya páginas que analizar. |
| Scripts de build de dependencias | Al añadir paquetes, pnpm 12 rechazó la instalación congelada con `ERR_PNPM_IGNORED_BUILDS` (@parcel/watcher, cpu-features, esbuild, protobufjs, ssh2), dependencias que ya existían. Se registró la denegación explícita en `allowBuilds` de `pnpm-workspace.yaml`, que mantiene la política de runtime.md de no ejecutar scripts de ciclo de vida. Las suites pasan sin ellos. Sin esta entrada, un clon limpio fallaría en `pnpm install --frozen-lockfile`. |
| `test:unit` | Vitest (proyectos `unit` de tests/unit y web) + Jest para API/worker (research.md: Jest backend, Vitest componentes). Ambos con cobertura. |
| Pruebas de comportamiento nuevas | `HealthController`: HTTP real con Nest y servicio simulado, 200/503/no-store, liveness sin consultar dependencias. `HealthService` con dependencias rechazadas: no disponible en menos de 3s y registro solo del nombre de la dependencia, sin URL ni credencial. Worker: sondeo falla sin señal, el proceso sigue vivo, registra indisponibilidad sin secretos y cierra limpio. `coverage-merge`: rojo inicial (módulo inexistente) y luego verde. Las pruebas de API/worker caracterizan comportamiento ya implementado en T011/T012, así que pasaron en la primera ejecución; no se presenta como TDD. |
| `test:integration` | Igual que antes, con `--coverage`. Solo cuenta el código cargado en el proceso de Jest; los procesos hijos (API/worker/web arrancados por las pruebas) no se instrumentan, así que su cobertura no se infla. `.tsx` lo mide Vitest. |
| `coverage:merge` | `scripts/coverage-merge.ts` fusiona `coverage/{unit-vitest,unit-jest,integration}/lcov.info` en `coverage/lcov.info`: rutas POSIX relativas a proyecto/, un registro por archivo con contadores sumados, LF/LH/FNF/FNH/BRF/BRH recalculados, sin tests/specs/node_modules/.next/dist/.d.ts ni rutas fuera del workspace. Falla con salida 1 si no hay informes o cobertura. |
| `build` | `turbo run build`: web `next build`; API y worker `tsc -p tsconfig.build.json` hacia `apps/{api,worker}/dist` (rootDir en proyecto/ para incluir packages/config). `dist/` ya estaba ignorado. Los Dockerfiles de T042 decidirán cómo empaquetarlo. |
| `test:e2e` | `playwright.config.ts`: testDir tests/e2e, Chromium, sin reintentos (un fallo intermitente no se oculta), `webServer` = `pnpm dev` (o `pnpm dev --env-file $E2E_ENV_FILE`) esperando `/api/health` 200, sin reutilizar servidores existentes. |
| `test:smoke` | `tests/smoke/playwright.config.ts`: nunca arranca servidores; exige `SMOKE_WEB_URL` y `SMOKE_API_URL` http(s) sin credenciales y falla por nombre de variable si faltan. |
| lint/format/typecheck | Incluyen las configuraciones nuevas y tests/e2e y tests/smoke. |

## Comandos y resultados (cwd proyecto/)

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | Antes de `allowBuilds`: salida 1 (`ERR_PNPM_IGNORED_BUILDS`). Después: 0 |
| `pnpm typecheck` / `pnpm lint` / `pnpm format:check` | 0 / 0 / 0 |
| `pnpm exec vitest run tests/unit/coverage-merge.spec.ts` antes de implementar | 1: no se puede importar `scripts/coverage-merge.js` |
| `pnpm test:unit` | 0. Vitest 4 archivos, 24 pruebas; Jest 3 suites, 7 pruebas; dos LCOV generados |
| `pnpm build` | 0. Next compila `/` estática y `/api/health` dinámica; tsc emite API y worker |
| `node apps/api/dist/apps/api/src/main.js` y worker compilado, con Compose | `/health` 200 `{"status":"ok","version":"local"}` + no-store; `/health/live` 200; worker `worker_ready` con versión e instanceId; stderr vacío |
| `docker compose ... up -d --wait` | 0, cuatro servicios healthy en loopback |
| `pnpm test:integration` | 0. 5 suites, 24/24, 139s, sin avisos de instrumentación |
| `pnpm coverage:merge` | 0. 32 archivos fuente desde 3 informes; 352/478 líneas (≈73,6 %), métrica local orientativa, no el Quality Gate |
| `E2E_ENV_FILE=.env.example pnpm test:e2e` con una prueba temporal de solo peticiones | 0. 1 passed: `/` 200 y `/api/health` 200 + no-store + version local; al terminar, 0 listeners en 3000/3001 |
| `pnpm test:smoke` sin variables | 1: `Falta SMOKE_WEB_URL: el smoke requiere una URL explícita` |
| `pnpm test:smoke` con credenciales en la URL | ≠0: `SMOKE_WEB_URL no debe incluir credenciales` |
| `pnpm test:smoke` contra API compilada + `next start` local, prueba temporal | 0. 1 passed (`/`, `/api/health`, API `/health/live`) |
| `docker compose ... down` (sin -v) | 0; los cuatro volúmenes se conservan |

Las dos pruebas temporales de Playwright se borraron antes del commit: solo comprobaban la configuración. Hasta T018, `pnpm test:e2e` y `pnpm test:smoke` con URLs terminan en «No tests found» (salida distinta de cero), que es lo esperado: no se usa `--pass-with-no-tests` para no aprobar en falso.

## Límites

No incluye la descarga de navegadores (`pnpm exec playwright install chromium`, quickstart), que se hace en T018. Tampoco hay E2E/axe reales (T018), CI, Sonar ni despliegues, y no se miden umbrales de cobertura por módulo. Esta evidencia corresponde a la máquina del autor; el clon limpio independiente es T022.
