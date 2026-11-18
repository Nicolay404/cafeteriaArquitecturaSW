# T029 — acceso efectivo a GitHub (puerta A1)

2026-11-18. Consultado con la API de GitHub desde la cuenta del líder. Sin tokens ni valores secretos: solo nombres y permisos.

| Capacidad | Resultado | Evidencia |
|---|---|---|
| Permisos sobre el repositorio | **Administrador** | `permissions.admin = true` |
| Visibilidad | Pública | `visibility = public` (CodeQL, Actions y rulesets sin coste) |
| GitHub Actions | Habilitado, todas las acciones permitidas | `actions/permissions`: `enabled = true`, `allowed_actions = all` |
| Token de workflows por defecto | **Solo lectura**, y los workflows no pueden aprobar PR | `default_workflow_permissions = read`, `can_approve_pull_request_reviews = false`; cada job declara además `permissions` mínimos |
| Rulesets | Creación y borrado probados | ruleset 27526256 creado; uno temporal creado y borrado |
| Métodos de fusión del repositorio | Merge, squash y rebase habilitados; el ruleset deja **solo rebase** | `allow_*_merge`; regla `allowed_merge_methods` |
| Colaboradoras | `mpguallo` y `rafapalacios5` con permiso de escritura (no administradoras) | `collaborators` |
| Secretos de Actions | `SONAR_TOKEN` (solo el nombre; el valor no es legible) | `gh secret list` |
| Environments | **Ninguno** (0) | `environments.total_count = 0`: los de staging y producción no existen porque no hay despliegue (ver `alcance-local.md`) |
| GHCR | **No probado.** El token de workflows es de solo lectura; publicar imágenes necesitará `packages: write` en el job que las publique, y aún no hay imágenes ni Dockerfiles | T042 |
| Workflows ejecutados | `Calidad del PR` y `Seguridad` en cada PR | PR #4: 11 checks en verde |

## Qué no se afirma

No se comprobó la publicación en GHCR, ni los environments con revisores, ni que las colaboradoras puedan aprobar PR en la práctica (solo que tienen permiso de escritura). Los dos primeros no aplican mientras no haya despliegue.
