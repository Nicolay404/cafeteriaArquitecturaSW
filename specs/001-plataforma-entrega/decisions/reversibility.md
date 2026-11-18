# Reversibilidad: rollback primero, revert después — T054

**Estado:** propuesto, verificado en local · **Fecha:** 2026-11-18 · **Constitución:** principio VII · **Requisitos:** FR-005, SC-007, US4.

## Principio

Ante un problema en un entorno, **primero se restaura el servicio** (rollback del despliegue o apagar un flag) y **después** se corrige `main` con `git revert` por PR, para que el repositorio refleje lo que corre. Nunca al revés: un revert pasa por el pipeline completo y tarda más que apagar un flag.

## Qué se deshace y con qué

| Qué cambió | Cómo se deshace | Por qué |
|---|---|---|
| Código de una función ya integrada | `git revert` del commit, por PR, con historial lineal | Los commits son atómicos y verdes, así que cada uno se puede revertir solo |
| Función incompleta o riesgosa | **Apagar su flag**, sin redeploy | Se integra detrás de un flag que falla apagado |
| Migración de base de datos **ya aplicada** | **Una migración nueva** (compensación), nunca `git revert` | El runner se niega a arrancar si una migración aplicada desaparece o cambia (checksum) |

## Expandir y contraer (migraciones)

Una migración nunca se edita ni se borra una vez aplicada. Se avanza en dos tiempos, en despliegues distintos:

1. **Expandir (versión N):** solo cambios que la versión anterior (N−1) tolera: columna opcional, tabla nueva, índice. N−1 sigue funcionando.
2. **Migrar el código:** N usa lo nuevo. Cuando N−1 ya no corre en ningún entorno:
3. **Contraer:** quitar lo viejo o añadir `NOT NULL`. Si se hiciera antes, N−1 dejaría de poder escribir.

Si una migración sale mal, **no se revierte**: se escribe otra que la corrige conservando los datos. Los fixtures de `tests/fixtures/migrations/` lo demuestran: `003` añade `NOT NULL` y rompe a N−1 (la prueba lo comprueba), y `004` quita la restricción, con las filas intactas.

Un fallo a mitad de una migración la deshace entera: no queda nada parcial y N−1 sigue atendiendo, porque cada archivo se aplica en una transacción y las anteriores siguen aplicadas.

## Flags técnicos

Redis guarda cada flag como un hash `<prefijo>:<clave>` con `enabled`, `revision` y `changedAt`. La API los lee en cada petición y **falla apagada** ante Redis caído, valor ausente o corrupto. Solo `pnpm flags:set <clave> <on|off>` escribe, con una clave de una lista cerrada (`TECHNICAL_FLAGS`), valor booleano y, por ahora, solo desde un entorno local. La API no tiene ninguna ruta de escritura. Staging y producción esperan la identidad del pipeline (T055).

## Verificar que un revert es desplegable

```powershell
Set-Location proyecto
corepack.cmd pnpm exec tsx ../scripts/ci/verify-revert.ts --repo .. --sha <sha-del-commit>
```

Crea una copia desechable de `HEAD` (sin tocar tu rama ni tu árbol de trabajo), aplica el revert sin confirmarlo e instala, comprueba tipos, compila y prueba. Informa `FALLO` si el revert tiene conflicto o deja un estado no desplegable (por ejemplo, revertir un proveedor del que otro commit depende: hay que revertir también ese commit). Si el commit tocaba `proyecto/infra/migrations/`, **conserva esos archivos** y lo indica, porque la migración se corrige con otra nueva. `--sin-migraciones` reproduce el revert ingenuo para ver por qué no sirve.

## Orden de actuación ante un incidente

1. Apagar el flag de la función afectada (`flags:set ... off`), o restaurar el despliegue anterior cuando exista pipeline.
2. Comprobar que el servicio se recuperó.
3. Si hay una migración implicada, escribir la migración de compensación.
4. Abrir el PR de `git revert` y comprobar antes con `verify-revert`.

## Límites

- Todo esto se ensayó **en local**. El rollback automático de Vercel y Render y la prueba sobre staging y producción dependen de la nube y quedan **no evaluables** (T055, T056; ver `alcance-local.md`).
- `verify-revert` comprueba lo que comprueban tipos, build y pruebas unitarias: no demuestra que el revert sea seguro en datos reales.
- El runner de migraciones solo se ejecuta a mano y solo en local (`pnpm db:migrate`). Ejecutarlo antes de activar el backend en el pipeline llega con T055.
- SC-007 pide revertir commits de `main` elegidos al azar en CI: es T056.
