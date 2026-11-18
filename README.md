# Proyecto Cafetería

La raíz de este repositorio sigue siendo la raíz de **Git y de los agentes**. Abrir aquí Codex, Claude Code o Antigravity y leer `AGENTS.md`, la constitución en `.specify/memory/constitution.md` y el spec correspondiente. No ejecutar `git init` dentro de `proyecto/` ni crear otra rama automáticamente.

El monorepo vive en **`proyecto/`**. Los comandos de Node, Corepack, pnpm, Turbo, tipos, lint y tests se ejecutan desde ese directorio. Git se puede invocar desde allí porque descubre el mismo `.git` de la raíz; las rutas documentales `docs/` y `specs/` siguen perteneciendo al repositorio, no al workspace.

```text
cafeteriaArquitecturaSW/              raíz Git y agentes
├── .git/
├── .agents/  .claude/  .specify/
├── AGENTS.md  CLAUDE.md  .gitignore
├── README.md  promtp.md  ROADMAP.md  skills-lock.json
├── docs/architecture/cafeteria.drawio
├── specs/001-plataforma-entrega/
│   ├── spec.md  plan.md  tasks.md  quickstart.md
│   ├── contracts/  checklists/  decisions/  evidence/
└── proyecto/                        raíz pnpm/Turbo
    ├── apps/
    │   ├── api/                     salud Nest y nueve módulos de negocio vacíos
    │   ├── web/                     inicio básico y proxy de salud, sin diseño final
    │   └── worker/                  sondeo técnico AMQP y heartbeat Redis privado
    ├── packages/{config,contracts,ui}/
    ├── scripts/env-check.ts
    ├── tests/unit/config.spec.ts
    ├── package.json  pnpm-workspace.yaml  pnpm-lock.yaml  turbo.json
    ├── .node-version  .npmrc  .env.example  .dockerignore
    └── tsconfig.json  eslint.config.mjs  .prettierrc.json  .prettierignore
```

Árbol de fuentes y configuración: omite archivos ignorados. Las dependencias/cachés anteriores se conservaron en sus ubicaciones originales; pueden quedar directorios `apps/` o `packages/` antiguos que contienen exclusivamente archivos generados ignorados. No forman otro workspace. No se trasladaron `node_modules`, `.turbo` ni archivos `.env` privados; una instalación nueva crea dependencias ignoradas dentro de `proyecto/`.

## Arranque local (T001–T020)

Requisitos: Git, Docker Desktop con el motor Linux iniciado, y Node **24.22.1** con pnpm **12.21.0** (ambos fijados; pnpm llega por Corepack, sin instalación global). Rama del Spec #1: `feature/spec-1`. Todos los comandos, en PowerShell y desde `proyecto/`; en Linux usar `corepack` en vez de `corepack.cmd`.

### 1. Instalar y comprobar

```powershell
git branch --show-current
Set-Location proyecto
corepack.cmd pnpm install --frozen-lockfile
corepack.cmd pnpm typecheck
```

Si `pnpm` no está en el PATH, Turbo (que usan `typecheck` y `build`) necesita un shim. Se habilita **solo para esa terminal**, sin tocar la instalación global ni la política de PowerShell:

```powershell
$shims = Join-Path $env:TEMP 'cafeteria-corepack-shims'
New-Item -ItemType Directory -Force -Path $shims
corepack.cmd enable --install-directory $shims pnpm
$env:PATH = $shims + [System.IO.Path]::PathSeparator + $env:PATH
```

`--frozen-lockfile` no debe regenerarse para ocultar problemas. No se usa `--ignore-scripts`: `pnpm-workspace.yaml` ya declara qué dependencias no ejecutan scripts (`allowBuilds`).

### 2. Entorno

`proyecto/.env.example` trae valores **solo para pruebas locales** (no reutilizar en la nube). Dos opciones:

- Copiarlo: `Copy-Item .env.example .env` (`.env` está ignorado por Git).
- O pasarlo en cada comando: `--env-file .env.example`.

Sin `.env` y sin `--env-file`, los comandos fallan nombrando la primera variable que falta (por ejemplo `Configuración inválida: NODE_ENV`); nunca imprimen valores. Compose también necesita ese archivo: `--env-file .env` o `.env.example`.

### 3. Infraestructura (Docker Compose)

```powershell
docker compose --env-file .env.example -f infra/compose.yaml up -d --wait --wait-timeout 150
corepack.cmd pnpm infra:check --env-file .env.example
```

Levanta Postgres, Redis, RabbitMQ y Mailpit, todos en `127.0.0.1`. `infra:check` hace un `SELECT` técnico, escribe/lee/borra una clave en Redis, publica y consume un mensaje correlacionado en RabbitMQ y comprueba Mailpit (HTTP y saludo SMTP). Imprime `OK`/`ERROR` por servicio y devuelve **1** si alguno falla, sin mostrar credenciales ni URLs.

| Servicio | Puerto en 127.0.0.1 |
|---|---|
| Web (Next.js) | 3000 |
| API (Nest) | 3001 |
| Postgres | 5432 (ajustable con `POSTGRES_PORT`) |
| Redis | 6379 |
| RabbitMQ | 5672 (AMQP), 15672 (gestión) |
| Mailpit | 1025 (SMTP), 8025 (interfaz web) |

Si **5432 está ocupado** por otro programa (por ejemplo un Postgres instalado en Windows), no lo detengas: usa otro puerto para Postgres en esa terminal.

```powershell
$env:POSTGRES_PORT = '55432'
$env:DATABASE_URL = 'postgresql://cafeteria_local:solo_pruebas_locales@127.0.0.1:55432/cafeteria_local'
```

El entorno del proceso tiene prioridad sobre el archivo. Comprobar antes qué ocupa un puerto: `Get-NetTCPConnection -State Listen -LocalPort 5432`.

### 4. Aplicación

```powershell
corepack.cmd pnpm dev --env-file .env.example
```

`dev` comprueba la infraestructura y arranca web, API y worker. Espera hasta ver `DEV_READY` y entonces:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/health        # API: status ok + version
Invoke-RestMethod http://127.0.0.1:3000/api/health    # mismo JSON a través de la web
Start-Process http://127.0.0.1:3000/                  # inicio básico
```

Detener con **Ctrl+C**. El wrapper `.cmd` de Windows pregunta si terminar el trabajo por lotes (`Terminate batch job (Y/N)?` en Windows en inglés): responde que sí. La salida 1 por interrupción es esperada y no es un fallo del arranque; los tres procesos hijos se cierran y quedan libres los puertos 3000 y 3001.

### 5. Parada y segundo arranque

```powershell
docker compose --env-file .env.example -f infra/compose.yaml down
```

`down` **conserva los volúmenes** (datos de Postgres, Redis, RabbitMQ y Mailpit) y el siguiente `up` los recupera. **No añadas `-v`** salvo que quieras borrar a propósito los datos de prueba locales.

### 6. Errores frecuentes

| Síntoma | Causa y salida |
|---|---|
| `Configuración inválida: NOMBRE` | Falta o es inválida esa variable. Copiar `.env.example` o usar `--env-file`. Si es `API_PORT`/`WEB_PORT` y el mensaje aparece al arrancar, el puerto está ocupado: liberarlo o cambiarlo. |
| `infra:check` muestra `ERROR` y sale con 1 | Compose no está levantado, o ese servicio no está sano: `docker compose ... ps`. Si es Postgres con 5432 ocupado, usar el override anterior. |
| `docker` no responde | Iniciar Docker Desktop (`docker desktop start`) y esperar al motor Linux. |
| Mailpit marca `ERROR` pero su web responde | El saludo SMTP tardaba por DNS inverso; Compose ya lo desactiva (`MP_SMTP_DISABLE_RDNS`). Recrear el contenedor con `up -d --force-recreate mailpit`. |

Mensajes y comprobaciones reales de esta guía, con fechas y resultados, en [bootstrap-procedure.md](specs/001-plataforma-entrega/evidence/bootstrap-procedure.md).

## Calidad y pruebas

```powershell
corepack.cmd pnpm lint
corepack.cmd pnpm format:check
corepack.cmd pnpm typecheck
corepack.cmd pnpm test:unit          # Vitest + Jest, con cobertura
corepack.cmd pnpm test:integration   # Testcontainers: necesita Docker; usa contenedores propios, no Compose
corepack.cmd pnpm build
corepack.cmd pnpm exec playwright install chromium   # una sola vez
$env:E2E_ENV_FILE = '.env.example'; corepack.cmd pnpm test:e2e   # con Compose levantado
corepack.cmd pnpm coverage:merge     # un único coverage/lcov.info
```

`test:smoke` apunta a un entorno ya arrancado y exige `SMOKE_WEB_URL` y `SMOKE_API_URL`. Axe sin violaciones **no demuestra WCAG AAA**: faltan lector de pantalla y revisión humana. Un solo test: ver `CLAUDE.md`. Resultados y límites en [quickstart.md](specs/001-plataforma-entrega/quickstart.md).

## Commits y hooks

Los commits siguen **Conventional Commits con el módulo como alcance**: `tipo(alcance): descripción`, por ejemplo `feat(pedidos): crear pedidos con clave de idempotencia`. Tipos: feat, fix, docs, test, refactor, perf, build, ci, chore, style, revert. El alcance es obligatorio y debe ser un módulo (identidad, clientes, catalogo, promociones, carrito, pedidos, pagos, notificaciones, reportes) o un área (plataforma, infra, ci, deps, config, contratos, ui, web, api, worker, seguridad, calidad, metricas, observabilidad, release, docs, specs, speckit, arquitectura). La lista y las reglas están en `proyecto/commitlint.config.cjs`.

`pnpm install` activa los hooks de Husky (`core.hooksPath`): **commit-msg** valida el mensaje y **pre-commit** revisa con Prettier y ESLint solo los archivos del índice, sin modificarlos ni guardar stash. Solo necesitan Node y las dependencias instaladas. Se pueden omitir con `git commit --no-verify` o `HUSKY=0`, pero el pipeline repite la comprobación de cada commit del PR (`scripts/ci/verify-commits.ts`), así que saltarse el hook solo retrasa el error.

Verificar a mano que cada commit de tu rama es válido y verde por sí solo (instala y prueba cada uno en un checkout temporal, sin tocar tu rama):

```powershell
Set-Location proyecto
corepack.cmd pnpm exec tsx ../scripts/ci/verify-commits.ts --repo .. --base main
```

Para que el PR se pueda integrar: rebase sobre `main` e historial lineal, sin commits de merge.

## Rutas para automatización futura

Compose local ya existe (arriba). Todavía **no existen workflows ni configuración de proveedores**; deberán respetar estas rutas:

| Área | Ubicación que deberá usar |
|---|---|
| Workflows | `.github/workflows/` en raíz Git; pasos de aplicación con `working-directory: proyecto` |
| Versión/cache de CI | `proyecto/.node-version`, `proyecto/pnpm-lock.yaml` desde checkout raíz |
| Scripts de aplicación | `proyecto/scripts/`; `env-check.ts` ya trasladado |
| Scripts Git/historial/revert | Futuro `scripts/ci/` en raíz; operaciones Git desde repositorio y chequeos de aplicación delegados a `proyecto/` |
| Hooks Git | Futuro `.husky/` en raíz; llamar toolchain de `proyecto/` |
| Sonar | Base `proyecto/`, propiedades futuras `proyecto/sonar-project.properties` y reportes relativos al workspace |
| Docker | Contexto `proyecto/`, `.dockerignore` allí; Dockerfiles futuros `proyecto/apps/api/Dockerfile` y `proyecto/apps/worker/Dockerfile` (rutas `apps/...` desde el contexto) |
| Compose | Ya existe en `proyecto/infra/compose.yaml`; desde `proyecto/`: `docker compose --env-file .env -f infra/compose.yaml ...` |
| Render | Blueprint futuro `proyecto/render.yaml`, contexto/Dockerfiles coherentes con la fila anterior |
| Vercel | Configuración futura `proyecto/vercel.json`, frontend `proyecto/apps/web`, paquetes compartidos del monorepo dentro de `proyecto/` |

Los patrones internos `apps/*`, `packages/*`, las extensiones TypeScript, el cargador `.env` y el root de ESLint siguen siendo relativos al workspace, no deben duplicar el prefijo `proyecto/`. Las rutas conceptuales antiguas del producto se ubican ahora bajo ese directorio. El draw.io permanece exactamente en `docs/architecture/cafeteria.drawio`; `spec.md` no cambia requisitos.

La evidencia de verificaciones y límites de esta reorganización queda en [workspace-reorganization.md](specs/001-plataforma-entrega/evidence/workspace-reorganization.md).
