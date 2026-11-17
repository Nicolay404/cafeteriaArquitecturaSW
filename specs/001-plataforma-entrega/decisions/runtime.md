# Matriz de runtime — T002

2026-11-16. Decisión técnica de bootstrap dentro del stack aprobado; no aprobación visual ni configuración cloud.

| Componente | Versión exacta | Motivo |
|---|---|---|
| Node | 24.22.1 | Runtime local disponible, línea LTS 24 compartida con proveedores |
| pnpm | 12.21.0 | Corepack existente, sin instalación global; lockfile congelado |
| TypeScript | 5.9.3 | Dentro de rango >=4.8.4 <6.1 de typescript-eslint; no TS 7 |
| Next / React / React DOM | 16.4.6 / 19.3.1 / 19.3.1 | Peers compatibles y servidor Next importable, sin páginas todavía |
| Nest common/core/platform-express | 12.5.1 | Misma versión, módulos ESM con Node 24 |
| reflect-metadata / RxJS | 0.2.2 / 7.8.2 | Peers de Nest |
| Turbo | 2.11.11 | Orquestación monorepo |
| ESLint / typescript-eslint / boundaries | 10.15.0 / 8.73.0 / 7.4.4 | Tipos y límites entre módulos |
| Prettier / tsx / Vitest | 3.10.1 / 4.23.15 / 5.1.0 | Formato, ejecutar scripts TS y pruebas de configuración |
| @types/node / @types/react / @types/react-dom | 24.10.1 / 19.3.0 / 19.3.0 | Tipos de la línea runtime/UI usada |

Metadatos engines/peers consultados con npm.cmd view. Instalación inicial sin scripts de ciclo de vida; imports reales de next/react/react-dom/server/Nest/TypeScript/lint/Vitest pasaron. tsc/eslint/prettier/turbo devolvieron las versiones fijadas. Instalación congelada con registro pasó; offline falló por metadatos de política de dependencias no cacheados. No desactivar políticas para forzar offline. pnpm generó excepciones explícitas minimumReleaseAgeExclude para las versiones directas seleccionadas y sus paquetes internos; no deshabilitar globalmente esa política.

[Render](https://render.com/docs/node-version) permite .node-version; [Vercel](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) soporta línea 24, pero gestiona sus parches: no se afirma control del patch exacto cloud ni despliegue validado. [Next](https://nextjs.org/docs/app/getting-started/installation) requiere Node >=20.9; [Nest](https://docs.nestjs.com/faq/versions) documenta compatibilidad. Proveedores solo contrastados documentalmente. Builds web/health/integración runtime quedan en tareas posteriores; importar frameworks no los prueba.

En este Windows npm.ps1 está bloqueado por política; npm.cmd funciona. Usar `corepack.cmd pnpm` sin cambiar ExecutionPolicy ni instalar shims globales. El cache COREPACK_HOME de esta ejecución vive en Temp; no es dependencia del repo. Un clon nuevo debe poder descargar pnpm por Corepack y dependencias por registro. Docker no está en PATH; afecta T007, no la matriz de Node.

## Ajustes verificados de T003–T008

Se añadió `eslint-import-resolver-typescript` 4.4.5: resuelve imports .js hacia fuentes .ts para que no eludan fronteras. La regla moderna `boundaries/dependencies` permite index público y bloquea implementaciones internas y dominio→platform. Se probaron ambos sufijos .ts/.js. Referencia de configuración: https://www.jsboundaries.dev/docs/rules/entry-point/ (migración a dependencies). No usar reglas deprecated de versiones previas.

pnpm 12 guarda configuración de proyecto en pnpm-workspace.yaml: saveExact/engineStrict/strictPeerDependencies activados; .npmrc no contiene secretos ni ajustes ignorados. La instalación congelada final de siete proyectos pasó y su SHA256 no cambió. El lockfile generado por pnpm incluye varios documentos YAML (gestor y aplicación); no editarlo manualmente.

Turbo necesita un ejecutable pnpm en PATH aunque se invoque el script mediante Corepack. En esta máquina se habilitaron shims solo en Temp, sin cambiar PATH persistente ni Program Files:

```powershell
$taskShims = Join-Path $env:TEMP 'cafeteria-corepack-shims'
New-Item -ItemType Directory -Force -Path $taskShims
corepack.cmd enable --install-directory $taskShims pnpm
$env:PATH = $taskShims + [System.IO.Path]::PathSeparator + $env:PATH
corepack.cmd pnpm typecheck
```

Con shims temporales, typecheck raíz y cinco proyectos con fuentes pasaron; config se comprueba mediante raíz y lint. Las dependencias se instalaron sin scripts lifecycle; se comprobaron imports/herramientas, no builds/arranque de aplicaciones futuras. No afirmar inicio/health funcionando todavía. La prueba env:check con `node --env-file=.env.example --import tsx scripts/env-check.ts` pasó sin crear .env. Los 11 casos Vitest de configuración pasaron fuera del sandbox; el sandbox restringía userInfo de Windows usado por tsx. Esto no es un fallo de validación de variables.


Actualización de ubicación: la solicitud de reorganización sitúa fuentes/configuración en proyecto/, sin cambiar Git ni agentes. Las rutas y comandos históricos de esta decisión se interpretaban antes del traslado; consultar README.md y evidence/workspace-reorganization.md para ubicaciones/verificación actual. Nueva ventana de edición limitada a traslado, rutas, documentación y chequeos existentes; sin tareas adicionales.
