# Reorganización del workspace bajo proyecto/

Fecha: 2026-11-16. Rama `feature/spec-1`; mismo HEAD base `de618f55c3d7aaea38037244f8195202ff55f28b`, sin commits/push. Solicitud limitada a estructura/rutas/documentación y chequeos existentes; sin avance de tareas ni configuración CI/Docker/cloud.

## Preservación y movimiento

Se revisó git status --short antes de mover. Se conservaron los cambios previos de .gitignore, .specify, CLAUDE.md, agentes, documentación y preparación del monorepo. Todos los destinos absolutos se comprobaron dentro de proyecto/ antes de Move-Item; se rechazaron colisiones y rutas de node_modules/.turbo/.git/.env privados. Solo se seleccionaron fuentes/configuración versionables y .env.example.

55 archivos trasladados: 53 conservan exactamente su hash previo. Los otros dos tienen ajustes de alcance documentados: packages/config/eslint.config.mjs ahora explica que su raíz calculada es proyecto/ y elimina ignores de documentación/agentes exteriores; .prettierignore elimina esas rutas exteriores. Los patrones apps/packages/tests, imports relativos, tsconfig, Turbo y carga de entorno conservan su relación interna al moverse todo el workspace.

Lockfile proyecto/pnpm-lock.yaml idéntico byte por byte al existente antes de reorganizar; no regenerado. También coinciden los hashes previos de spec.md, docs/architecture/cafeteria.drawio, AGENTS.md, CLAUDE.md, .gitignore y los archivos .specify protegidos en el snapshot de sesión. No se cambiaron requisitos ni marcadores de checklists.

scripts/ solo contenía env-check.ts: valida aplicaciones y se trasladó a proyecto/scripts/. .specify/scripts/ sigue en raíz como herramienta del repositorio. Los futuros scripts de historial/revert scripts/ci/verify-commits.ts y verify-revert.ts permanecen planificados desde raíz Git; no se crearon aquí.

Las dependencias/cachés anteriores permanecen en raíz y en ubicaciones antiguas ignoradas dentro de apps/packages. No fueron movidas ni eliminadas. La instalación genera node_modules ignorado nuevo en proyecto/. El árbol de fuentes de README omite esos restos generados y directorios vacíos; no hay fuentes duplicadas en apps/packages/tests/scripts de raíz.

## Rutas corregidas y documentos

| Antes | Ahora / interpretación |
|---|---|
| apps/, packages/, tests/ | proyecto/apps/, proyecto/packages/, proyecto/tests/ |
| scripts/env-check.ts | proyecto/scripts/env-check.ts |
| Manifiestos, lockfile y configuración Node/pnpm/Turbo | Dentro de proyecto/; importers/patrones internos permanecen relativos |
| TypeScript/ESLint/Prettier e ignores del workspace | Dentro de proyecto/; .gitignore permanece en raíz |
| .env.example | proyecto/.env.example; cargador busca proyecto/.env, nunca archivo privado raíz |
| docs/specs/agentes/Spec Kit | Conservados en raíz Git |
| docs/architecture/cafeteria.drawio | Sin mover ni editar |
| CI futuro | .github/workflows en raíz; cwd proyecto, versión/cache con prefijo proyecto/ |
| Docker futuro | Contexto proyecto, .dockerignore allí, Dockerfiles apps/api y apps/worker relativos al contexto |
| Compose/despliegue futuros | proyecto/infra/compose.yaml, proyecto/render.yaml, proyecto/vercel.json y frontend proyecto/apps/web |

Actualizados README.md, plan.md, tasks.md, quickstart.md y contratos de comandos (contracts/platform.md). runtime.md/shared-files.md conservan el registro histórico y añaden el cambio de ubicación. evidence/t001-t008.md es histórico, no se reescribieron sus resultados ni rutas originales; esta evidencia describe el estado posterior.

## Verificaciones ejecutadas desde proyecto/

| Comando o comprobación | Resultado |
|---|---|
| corepack.cmd pnpm@12.21.0 install --frozen-lockfile --ignore-scripts --offline | Primer intento sandbox bloqueó lock de caché; reintento aprobado pasó, siete proyectos, 278 paquetes reutilizados, cero descargas |
| SHA256 del lockfile antes/después | Idéntico al original; instalación no cambió el archivo |
| corepack.cmd pnpm@12.21.0 typecheck | Pasó raíz y cinco proyectos con fuentes; sin usar resultados cacheados de la ubicación anterior |
| corepack.cmd pnpm@12.21.0 lint | Pasó |
| corepack.cmd pnpm@12.21.0 format:check | Pasó |
| vitest run tests/unit/config.spec.ts | 11/11 pasaron; fuera de sandbox por limitación Windows/tsx conocida |
| node --env-file=.env.example --import tsx scripts/env-check.ts | Pasó; configuración válida API/worker/web sin imprimir valores ni crear .env |
| Resolución real de typescript/eslint/vitest/tsx | Todas dentro de proyecto/node_modules, no instalación antigua raíz |
| ESLint lintText de imports .ts y .js | Index público permitido, implementación interna rechazada; dominio→platform rechazado |
| git check-ignore | proyecto/node_modules, proyecto/.turbo y .env privados ignorados; proyecto/.env.example permitido |
| git rev-parse --show-toplevel | Misma raíz Git cafeteriaArquitecturaSW |
| git branch --show-current | feature/spec-1 |
| git diff --check | Sin errores de whitespace; avisos de normalización CRLF no cambiaron archivo protegido |

Para Turbo se añadió a PATH de la terminal el directorio de shims Corepack temporales ya existente; no se modificó PATH persistente ni instalación global. El resultado offline usa la caché de esta máquina y no demuestra un clon limpio sin red. La verificación de clon limpio completa es otra tarea: no marcada por este traslado.

Sin Compose, health, web/worker funcionales, E2E, build de aplicaciones ni servicios cloud ejecutados. T001–T006/T008 siguen completadas, T007 pendiente por Docker; T009 en adelante conservan su estado pendiente. No se crearon workflows, Blueprint, Vercel config ni Dockerfiles.

## Mapa completo de fuentes/configuración trasladadas

| Ruta anterior desde raíz Git | Ruta actual desde raíz Git |
|---|---|
| `apps/api/package.json` | `proyecto/apps/api/package.json` |
| `apps/api/src/index.ts` | `proyecto/apps/api/src/index.ts` |
| `apps/api/src/modules/carrito/carrito.module.ts` | `proyecto/apps/api/src/modules/carrito/carrito.module.ts` |
| `apps/api/src/modules/carrito/index.ts` | `proyecto/apps/api/src/modules/carrito/index.ts` |
| `apps/api/src/modules/catalogo/catalogo.module.ts` | `proyecto/apps/api/src/modules/catalogo/catalogo.module.ts` |
| `apps/api/src/modules/catalogo/index.ts` | `proyecto/apps/api/src/modules/catalogo/index.ts` |
| `apps/api/src/modules/clientes/clientes.module.ts` | `proyecto/apps/api/src/modules/clientes/clientes.module.ts` |
| `apps/api/src/modules/clientes/index.ts` | `proyecto/apps/api/src/modules/clientes/index.ts` |
| `apps/api/src/modules/identidad/identidad.module.ts` | `proyecto/apps/api/src/modules/identidad/identidad.module.ts` |
| `apps/api/src/modules/identidad/index.ts` | `proyecto/apps/api/src/modules/identidad/index.ts` |
| `apps/api/src/modules/notificaciones/index.ts` | `proyecto/apps/api/src/modules/notificaciones/index.ts` |
| `apps/api/src/modules/notificaciones/notificaciones.module.ts` | `proyecto/apps/api/src/modules/notificaciones/notificaciones.module.ts` |
| `apps/api/src/modules/pagos/index.ts` | `proyecto/apps/api/src/modules/pagos/index.ts` |
| `apps/api/src/modules/pagos/pagos.module.ts` | `proyecto/apps/api/src/modules/pagos/pagos.module.ts` |
| `apps/api/src/modules/pedidos/index.ts` | `proyecto/apps/api/src/modules/pedidos/index.ts` |
| `apps/api/src/modules/pedidos/pedidos.module.ts` | `proyecto/apps/api/src/modules/pedidos/pedidos.module.ts` |
| `apps/api/src/modules/promociones/index.ts` | `proyecto/apps/api/src/modules/promociones/index.ts` |
| `apps/api/src/modules/promociones/promociones.module.ts` | `proyecto/apps/api/src/modules/promociones/promociones.module.ts` |
| `apps/api/src/modules/README.md` | `proyecto/apps/api/src/modules/README.md` |
| `apps/api/src/modules/reportes/index.ts` | `proyecto/apps/api/src/modules/reportes/index.ts` |
| `apps/api/src/modules/reportes/reportes.module.ts` | `proyecto/apps/api/src/modules/reportes/reportes.module.ts` |
| `apps/api/src/platform/config.ts` | `proyecto/apps/api/src/platform/config.ts` |
| `apps/api/tsconfig.json` | `proyecto/apps/api/tsconfig.json` |
| `apps/web/package.json` | `proyecto/apps/web/package.json` |
| `apps/web/src/index.ts` | `proyecto/apps/web/src/index.ts` |
| `apps/web/src/server/config.ts` | `proyecto/apps/web/src/server/config.ts` |
| `apps/web/tsconfig.json` | `proyecto/apps/web/tsconfig.json` |
| `apps/worker/package.json` | `proyecto/apps/worker/package.json` |
| `apps/worker/src/config.ts` | `proyecto/apps/worker/src/config.ts` |
| `apps/worker/src/index.ts` | `proyecto/apps/worker/src/index.ts` |
| `apps/worker/tsconfig.json` | `proyecto/apps/worker/tsconfig.json` |
| `packages/config/eslint.config.mjs` | `proyecto/packages/config/eslint.config.mjs` |
| `packages/config/package.json` | `proyecto/packages/config/package.json` |
| `packages/config/src/env.ts` | `proyecto/packages/config/src/env.ts` |
| `packages/config/tsconfig.base.json` | `proyecto/packages/config/tsconfig.base.json` |
| `packages/contracts/package.json` | `proyecto/packages/contracts/package.json` |
| `packages/contracts/src/index.ts` | `proyecto/packages/contracts/src/index.ts` |
| `packages/contracts/tsconfig.json` | `proyecto/packages/contracts/tsconfig.json` |
| `packages/ui/package.json` | `proyecto/packages/ui/package.json` |
| `packages/ui/src/index.ts` | `proyecto/packages/ui/src/index.ts` |
| `packages/ui/tsconfig.json` | `proyecto/packages/ui/tsconfig.json` |
| `scripts/env-check.ts` | `proyecto/scripts/env-check.ts` |
| `tests/unit/config.spec.ts` | `proyecto/tests/unit/config.spec.ts` |
| `package.json` | `proyecto/package.json` |
| `pnpm-workspace.yaml` | `proyecto/pnpm-workspace.yaml` |
| `pnpm-lock.yaml` | `proyecto/pnpm-lock.yaml` |
| `turbo.json` | `proyecto/turbo.json` |
| `.node-version` | `proyecto/.node-version` |
| `.npmrc` | `proyecto/.npmrc` |
| `.env.example` | `proyecto/.env.example` |
| `tsconfig.json` | `proyecto/tsconfig.json` |
| `eslint.config.mjs` | `proyecto/eslint.config.mjs` |
| `.prettierrc.json` | `proyecto/.prettierrc.json` |
| `.prettierignore` | `proyecto/.prettierignore` |
| `.dockerignore` | `proyecto/.dockerignore` |
