# T019 — instalación y build congelados, y límites entre módulos

2026-11-18, Windows 11, rama feature/spec-1, commit a415eda. Autor local; la repetición independiente es T022.

## Clon limpio del candidato (solo lo commiteado)

`git clone --local --branch feature/spec-1` a una carpeta temporal nueva: sin `node_modules`, sin `.env`, sin cachés ni builds, y sin los cambios no commiteados del autor. Luego, con cwd proyecto/:

| Comando | Resultado |
|---|---|
| `pnpm install --frozen-lockfile` | 0, 12 s |
| `git status --porcelain` tras instalar | vacío: el lockfile y los manifiestos no cambian |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | 0, 0, 0 |
| `pnpm test:unit` | 0. Vitest 5 archivos / 30 pruebas; Jest 3 suites / 7 pruebas |
| `pnpm build` | 0. Web, API y worker (3 tareas) |
| `git status --porcelain` al terminar | vacío: ningún comando deja archivos versionados modificados |

La carpeta temporal se borró al terminar. No se usó `--ignore-scripts` ni se desactivó ninguna política: `allowBuilds` (T016) deja determinista la instalación con pnpm 12. Se reutilizó el almacén global de pnpm del autor, por lo que la descarga desde el registro con una caché vacía sigue siendo parte de T022.

## Versiones (coinciden con decisions/runtime.md)

Node 24.22.1 · pnpm 12.21.0 · TypeScript 5.9.3 · ESLint 10.15.0 · Prettier 3.10.1 · Vitest 5.1.0 · Playwright 1.64.1 · Turbo 2.11.11. SHA-256 de `proyecto/pnpm-lock.yaml`: `CC54DB6955E38AF30C71F4A415CF41529C02AB794371A08B79ACE4B4F29BF9B0`.

## Límites entre módulos (Constitución V)

`proyecto/tests/unit/module-boundaries.spec.ts` ejecuta el ESLint real del workspace sobre código en memoria colocado en rutas reales (la resolución de imports es la del proyecto, no una copia de la regla). 6/6:

- Rechaza que `pedidos` importe `catalogo/catalogo.module` (implementación interna).
- Acepta que `pedidos` importe `catalogo/index` (API pública) y su propio `./pedidos.module`.
- Rechaza que un dominio importe `platform/health.service`.
- Rechaza que `platform` importe `modules/pedidos/pedidos.module`.
- El código real de `apps/api/src` no tiene violaciones.

Los casos negativos pasan porque la regla se dispara, no por ausencia de comprobación. Describe una regla ya configurada en T004, por lo que pasó en la primera ejecución sin rojo previo.

## Límites

Esta regla comprueba imports entre módulos. No verifica permisos de base de datos ni propiedad de esquemas (aún no existen tablas; ver modules/README.md). Tampoco sustituye el clon independiente de T022, el pipeline de CI ni Sonar.
