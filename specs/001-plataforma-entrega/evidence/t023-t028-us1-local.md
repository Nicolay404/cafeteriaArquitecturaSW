# T023–T028 — controles de US1 que se pueden verificar en local

2026-11-18, Windows 11, PowerShell 5.1, Docker Desktop Linux 29.8.0, rama feature/spec-1 (base 586ed07 en adelante). Autor local. **Nada de esto se ejecutó todavía en GitHub Actions ni contra una cuenta de Sonar**: la aceptación externa pertenece a T029–T034 y requiere los accesos A1 y A2.

## Qué se hizo

| Tarea | Entrega | Verificado en local |
|---|---|---|
| T023 | `tests/unit/commit-validation.spec.ts`, `tests/unit/change-classification.spec.ts`, `tests/integration/commit-history.int.spec.ts` | Sí |
| T024 | `tests/unit/quality-gate.spec.ts` (42 casos) | Sí |
| T025 | `proyecto/commitlint.config.cjs`, `.husky/commit-msg`, `.husky/pre-commit`, `lint-staged.config.mjs`, `scripts/ci/staged-checks.mjs`, script `prepare` | Sí, con commits reales en un clon temporal |
| T026 | `scripts/ci/verify-commits.ts` | Sí, con repositorios temporales y con los comandos reales de pnpm/Turbo |
| T027 | `proyecto/scripts/ci/quality-gate.ts`, `proyecto/sonar-project.properties` | Script sí; propiedades de Sonar **sin comprobar** (necesita la cuenta, T030) |
| T028 | `.github/workflows/pr-quality.yml`, `.github/workflows/security.yml`, `osv-scanner.toml` | Sintaxis con actionlint 1.7.12 y los escáneres ejecutados a mano; **workflows sin ejecutar en GitHub** |

## T023/T025 — mensajes y hooks

- Reglas: tipo de una lista, alcance **obligatorio** y de una lista cerrada (módulos de dominio y áreas transversales), descripción sin punto final, cabecera de 100 como máximo.
- 13 pruebas de commitlint con la configuración real; antes de crearla fallaban 13/13.
- Hooks probados con commits reales en un clon temporal (ya borrado) tras `pnpm install`, que activa `core.hooksPath`:
  - mensaje `arreglos varios`: bloqueado (`subject-empty`, `type-empty`, `scope-empty`);
  - `feat: añadir prueba`: bloqueado (`scope-empty`);
  - `feat(cualquiercosa): ...`: bloqueado (`scope-enum`, con la lista de alcances válidos);
  - archivo sin formato: bloqueado por Prettier en `pre-commit`;
  - archivo formateado con `feat(plataforma): ...`: aceptado. Sin stash residual (`--no-stash`).
- Defecto encontrado y corregido: `lint-staged` guardaba un stash de respaldo aunque las comprobaciones solo leen; ahora usa `--no-stash`. También se fijaron finales LF para `.husky/*` en `.gitattributes`.
- Los hooks usan Node y `proyecto/node_modules` directamente: no dependen de que `pnpm` esté en el PATH. Los mensajes de commitlint salen en inglés.

## T026 — verificador de historial

- Recorre `base..head`; valida el mensaje con commitlint; comprueba cada commit en un `git worktree` temporal con su lockfile; modo `documentacion` (solo mensaje), `aplicacion` (Turbo `--filter=...[padre]` con `--force`, sin caché) o `raiz` (todo). Ante un archivo desconocido elige `raiz`. Rechaza historiales con merges.
- Integración con repositorios temporales (5/5): un PR correcto pasa con los modos esperados; **un commit intermedio roto se detecta con su SHA aunque la cabeza esté verde**; un mensaje inválido falla en su etapa sin instalar nada; un historial con merge se rechaza; una base inexistente falla sin tocar el repositorio. En todos, rama, HEAD, índice y `git worktree list` quedan idénticos.
- Con los comandos reales sobre esta rama: 3 commits en modo raíz, OK, 104 s (~35 s por commit); 1 commit en modo aplicación, OK, 30 s.
- Defecto encontrado y corregido: en Windows el borrado del checkout temporal fallaba con `EBUSY` y ese error ocultaba el veredicto. Ahora reintenta y solo avisa. No se añadió prueba automática porque es específico de Windows.
- Desviación respecto de tasks.md: las pruebas viven en `proyecto/tests/` y no en `scripts/ci/verify-commits.spec.ts`, para que las cubran los ejecutores, el lint y la cobertura del workspace. Los scripts de la raíz se declaran módulo ES con `scripts/ci/package.json`, se tipan con `tsconfig.json` (`../scripts/ci`) y se comprueban con Prettier; ESLint no los cubre porque quedan fuera de su carpeta base.

## T024/T027 — puerta de calidad

- Umbrales de la constitución en `THRESHOLDS`, con una prueba que los fija: bajarlos falla las pruebas y exige enmendar la constitución.
- Falla cerrado: resultado ausente, de otro commit, con métrica faltante, con cobertura sin dato en un cambio de código, o con un módulo crítico modificado sin su dato de cobertura. En un PR solo de documentación la cobertura figura como «no aplica», sin inventar un 100 %.
- Bloquea secretos (Gitleaks) y vulnerabilidades altas o críticas (Trivy). Un reintento verde no borra un fallo previo: queda «intermitente», bloqueado, con la causa original.
- Mutación: bajar la cobertura a 70, la duplicación máxima a 5, cambiar `>=` por `>` o desactivar la comprobación de ausencia hace fallar las pruebas.
- `fromSonarMeasures` traduce las métricas de código nuevo (`new_*`) de la API de Sonar. **Su forma está basada en la documentación y no se ha probado contra Sonar real.**
- La CLI se ejecutó con aprobado, bloqueado, archivo inexistente, sin resultado y secreto detectado: salida 0 solo en el primero.

## T028 — workflows (preparados, no ejecutados en GitHub)

- Permisos mínimos, `persist-credentials: false`, acciones fijadas por SHA con versiones de más de 2 semanas (consultadas con `gh api`, no inventadas), checks agregados `Calidad del PR` y `Seguridad` que no aprueban un control omitido o cancelado, y Sonar con token obligatorio (sin token, p. ej. un PR desde un fork, **no se aprueba**).
- `actionlint` 1.7.12: sin avisos. Prettier: formato correcto.
- Sin caché de pnpm por ahora (corepack debe activarse antes que `setup-node`); la optimización llega con T032.
- El escaneo de imágenes de API y worker llega con sus Dockerfiles (T042).

## Escáneres ejecutados a mano con Docker (mismas versiones que el pipeline)

| Herramienta | Resultado |
|---|---|
| Gitleaks 8.30.1, historial de 39 commits | Sin fugas |
| Gitleaks, árbol de trabajo completo | 12 hallazgos, **todos** en carpetas ignoradas (`node_modules`, `.next`); ninguno en archivos versionados |
| Trivy 0.76.1 `fs`, vulnerabilidades y secretos, HIGH/CRITICAL | 0 hallazgos |
| `pnpm audit --prod` | Sin vulnerabilidades conocidas |
| OSV-Scanner 2.7.0 sobre `pnpm-lock.yaml` (incluye dependencias de desarrollo) | **6 vulnerabilidades: 2 altas y 4 medias** |
| actionlint 1.7.12 | Sin avisos |

### Hallazgo H-06: OSV bloquearía el PR hoy

| Advisory | Paquete | Gravedad | Corrección | Quién lo trae |
|---|---|---|---|---|
| GHSA-fc5q-39xc-vjpf | picomatch ≤ 4.0.7 (2.3.2 y 4.0.7 en el lockfile) | **Alta**, CVSS 7,5 (ReDoS) | **Ninguna publicada** (4.0.7 es la última) | Jest y Vite (herramientas de desarrollo) |
| GHSA-3g3m-2fjr-6pw4 | glob 10.5.0 y 13.0.7 | Media | glob 14.0.2 | Testcontainers y Jest (desarrollo) |
| GHSA-g3hv-75wg-m249 | minimatch 9.0.9 y 10.2.6 | Media | minimatch 11.0.1 | Idem |

Todas están en herramientas de desarrollo y ninguna en lo que se despliega. Aun así, la constitución (II) dice que las vulnerabilidades altas bloquean el merge, y el job de OSV está configurado para bloquear. **No se creó ninguna excepción**: eso es una decisión del equipo (excepción temporal con motivo y fecha de caducidad en `osv-scanner.toml`, o esperar a un parche). Las medias pueden resolverse cuando sus dependientes actualicen; no bloquean.

## Límites

Estos resultados son del autor, en Windows. No hay protección de `main`, ni Sonar real, ni ejecución de los workflows (T029–T034). El comportamiento de `verify-commits` en el runner Linux no se ha probado; en Windows se ejecuta con `shell` para los shims `.cmd` de pnpm y Node avisa de una deprecación inocua (DEP0190) que no ocurre en Linux.
