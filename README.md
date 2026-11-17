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

## Verificaciones disponibles

Node **24.22.1**, pnpm **12.21.0** fijados; Corepack disponible. Desde raíz Git, en PowerShell:

```powershell
git branch --show-current
Set-Location proyecto
node --version
corepack.cmd pnpm install --frozen-lockfile --ignore-scripts
corepack.cmd pnpm typecheck
corepack.cmd pnpm lint
corepack.cmd pnpm format:check
corepack.cmd pnpm test:config
node --env-file=.env.example --import tsx scripts/env-check.ts
```

La rama activa autorizada del Spec #1 es `feature/spec-1-continuacion` (PR #2). `--frozen-lockfile` comprueba el lockfile existente; no regenerarlo para ocultar problemas de traslado. No se afirma instalación totalmente offline: pnpm puede necesitar metadatos de sus políticas de dependencias. La instalación indicada no ejecuta scripts lifecycle de dependencias. En Linux usar `corepack` en lugar de `corepack.cmd`.

Si pnpm no está en PATH, Turbo necesita un shim aunque el comando inicial use Corepack. Se puede habilitar **solo para esa terminal**, sin modificar instalación global ni política de PowerShell:

```powershell
$taskShims = Join-Path $env:TEMP 'cafeteria-corepack-shims'
New-Item -ItemType Directory -Force -Path $taskShims
corepack.cmd enable --install-directory $taskShims pnpm
$env:PATH = $taskShims + [System.IO.Path]::PathSeparator + $env:PATH
corepack.cmd pnpm typecheck
```

API/worker y el validador leen `proyecto/.env` si existe y dan prioridad al entorno del proceso. La web recibe variables del launcher/plataforma en runtime; no carga automáticamente archivos privados dentro del build. El comando con `--env-file=.env.example` prueba valores locales sin crear un archivo privado. Copiar el ejemplo a `.env` dentro del workspace será una elección local; no reutilizar/mover automáticamente secretos que existieran en la raíz.

T001–T014 están verificadas: Compose local, salud API, worker técnico, inicio básico y proxy runtime. Se ejecutan `corepack.cmd pnpm test:integration` (Docker real) y `corepack.cmd pnpm exec vitest run --config apps/web/vitest.config.ts`. Build web probado con `node apps/web/node_modules/next/dist/bin/next build apps/web` y NODE_ENV=production; sin `--env-file`, porque Next propaga flags incompatibles a sus workers. No existen todavía los scripts coordinados `dev`/`build`, E2E o despliegues; corresponden a las siguientes tareas. Esto no certifica H0 completo ni aprobación visual. Resultados y guía en [quickstart.md](specs/001-plataforma-entrega/quickstart.md).

## Rutas para automatización futura

Compose local existe en `proyecto/infra/compose.yaml`. Todavía **no existen workflows ni configuración de proveedores**; deberán respetar estas rutas:

| Área | Ubicación que deberá usar |
|---|---|
| Workflows | `.github/workflows/` en raíz Git; pasos de aplicación con `working-directory: proyecto` |
| Versión/cache de CI | `proyecto/.node-version`, `proyecto/pnpm-lock.yaml` desde checkout raíz |
| Scripts de aplicación | `proyecto/scripts/`; `env-check.ts` ya trasladado |
| Scripts Git/historial/revert | Futuro `scripts/ci/` en raíz; operaciones Git desde repositorio y chequeos de aplicación delegados a `proyecto/` |
| Hooks Git | Futuro `.husky/` en raíz; llamar toolchain de `proyecto/` |
| Sonar | Base `proyecto/`, propiedades futuras `proyecto/sonar-project.properties` y reportes relativos al workspace |
| Docker | Contexto `proyecto/`, `.dockerignore` allí; Dockerfiles futuros `proyecto/apps/api/Dockerfile` y `proyecto/apps/worker/Dockerfile` (rutas `apps/...` desde el contexto) |
| Compose | Futuro `proyecto/infra/compose.yaml`; desde `proyecto/`: `docker compose --env-file .env -f infra/compose.yaml ...` |
| Render | Blueprint futuro `proyecto/render.yaml`, contexto/Dockerfiles coherentes con la fila anterior |
| Vercel | Configuración futura `proyecto/vercel.json`, frontend `proyecto/apps/web`, paquetes compartidos del monorepo dentro de `proyecto/` |

Los patrones internos `apps/*`, `packages/*`, las extensiones TypeScript, el cargador `.env` y el root de ESLint siguen siendo relativos al workspace, no deben duplicar el prefijo `proyecto/`. Las rutas conceptuales antiguas del producto se ubican ahora bajo ese directorio. El draw.io permanece exactamente en `docs/architecture/cafeteria.drawio`; `spec.md` no cambia requisitos.

La evidencia de verificaciones y límites de esta reorganización queda en [workspace-reorganization.md](specs/001-plataforma-entrega/evidence/workspace-reorganization.md).
