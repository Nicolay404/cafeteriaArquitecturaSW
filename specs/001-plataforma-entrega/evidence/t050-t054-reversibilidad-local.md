# T050–T054 — reversibilidad verificada en local

2026-11-18, Windows 11, Docker Desktop Linux 29.8.0, rama feature/spec-1 (commits locales sin publicar sobre 518b351). Autor local. Todo con Postgres y Redis reales (Testcontainers y Compose). Nada de nube: el rollback real de Vercel y Render y T055–T056 quedan fuera (ver `decisions/alcance-local.md`).

## T050/T052 — flags técnicos

| Comprobación | Resultado |
|---|---|
| `flags.int.spec.ts` | 14/14 con Redis real |
| Sin valor, el flag está apagado y la capacidad de prueba responde 404 | Sí |
| Encender y apagar se refleja en la API **en marcha**, sin redeploy, con `revision` creciente y `changedAt` ISO | Sí |
| Clave fuera de la lista o valor no booleano | Rechazado sin escribir |
| La API ante POST, PUT, PATCH y DELETE | 404 o 405; el flag no cambia |
| Valor corrupto en Redis | Se trata como apagado |
| Redis sin respuesta | Apagado en menos de 2,5 s; al volver, recupera el valor |
| Reinicio de Redis | El valor persiste (el fixture usa `--appendonly yes`, igual que Compose) |
| `authorizeFlagWrite` | Permite local; rechaza staging, producción, Redis remoto y falta de `APP_ENV` |
| CLI `pnpm flags:set` contra Compose | `on` y `off` con revisión 1 y 2; clave no permitida, valor inválido y entorno staging con salida 1 |

Defecto encontrado y corregido: con una revisión corrupta (`x`) en Redis, `HINCRBY` fallaba y **no se podía volver a escribir el flag**. La escritura es ahora un script Lua atómico que trata una revisión inválida como 0; la prueba lo cubre.

## T051/T053 — migraciones

`scripts/db/migrate.ts` y `infra/migrations/001_platform_probe.sql` (tabla técnica sintética `platform.probe`, sin PII ni negocio). `migrations.int.spec.ts`, 8/8 sobre bases de datos nuevas por prueba:

- Aplica la 001 real, registra su checksum SHA-256 y es idempotente.
- Rechaza una migración aplicada y editada (checksum) y una aplicada que desaparece del repositorio.
- Rechaza un nombre fuera del patrón `NNN_descripcion.sql` antes de tocar la base.
- Con el bloqueo ocupado falla sin aplicar nada; dos ejecuciones simultáneas aplican la 001 una sola vez.
- Expandir es compatible con N−1 y con N.
- Una migración que falla a mitad se deshace entera (la columna de su primera sentencia no queda), las previas siguen aplicadas y N−1 sigue insertando.
- Contraer rompe a N−1 y se compensa con una migración nueva, con todas las filas intactas.

Mutación: quitar la comparación de checksum, el bloqueo o la detección de migraciones desaparecidas hace fallar 1 prueba cada vez. Quitar el `ROLLBACK` explícito no cambia el resultado porque Postgres deshace igualmente al cerrar la conexión: es una mutación equivalente, no una laguna.

## T054 — `verify-revert` y decisión de reversibilidad

`scripts/ci/verify-revert.ts` (reutiliza `withWorktree` y `runChecks`, ahora exportados de `verify-commits.ts`), 6 pruebas en `revert.int.spec.ts` con repositorios temporales: un revert independiente pasa; revertir un proveedor del que otro commit depende se detecta como no desplegable; un conflicto se informa con su texto y sin dejar rastro; revertir una migración conserva su archivo (y sin conservarlo el código quedaría sin su columna); un commit fuera de la base y una referencia inexistente se rechazan. En todos, rama, HEAD, índice y worktrees quedan idénticos.

Con los comandos reales de pnpm sobre esta rama: revert de `0cabd46` (puerta de calidad) OK en 69 s y de `53e297d` (flags) OK en 58 s; sin restos en `%TEMP%`.

Defecto encontrado y corregido: el texto del conflicto se perdía porque el error de `child_process` cruza contextos de ejecución en Jest y `instanceof Error` falla; ahora se lee `stdout`/`stderr` directamente. La decisión está en [reversibility.md](../decisions/reversibility.md).

## Cambios de configuración

`tsconfig.json` y `tests/integration/tsconfig.json` habilitan decoradores (las pruebas importan la API de Nest); `apps/api/src/platform/platform.module.ts` expone `createPlatformApp` para que las pruebas no importen Nest directamente; `main.ts` lo usa; nuevos scripts `flags:set` y `db:migrate`.

## Límites

Resultados del autor, en Windows. Staging y producción necesitan la identidad de pipeline (T055); `db:migrate` y `flags:set` se niegan a correr fuera de local. SC-007 (revert al azar en CI y staging) es T056 y no se afirma. El revert comprueba tipos, build y pruebas unitarias, no datos reales.
