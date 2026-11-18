# Controles de GitHub sobre `main` — T029 y T033

**Estado:** aplicado y verificado el 2026-11-18 · **Aprobado por:** líder del equipo (Nicolay) · **Pendiente:** confirmar con las colaboradoras.

## Regla vigente: ruleset «Proteger main» (id 27526256, activo)

| Regla | Valor | Qué evita |
|---|---|---|
| Pull request obligatorio | Sí, con **1 aprobación** | Cambios en `main` sin revisión de otra persona |
| Aprobación invalidada por cambios | Sí (`dismiss_stale_reviews_on_push`) | Aprobar y luego empujar cambios sin que nadie los vea |
| Métodos de fusión permitidos | **Solo rebase** | Commits de merge y squash: se conservan los commits individuales (constitución VII) |
| Historial lineal | Sí | Merges que ensucian el historial y dificultan revertir |
| Checks de estado obligatorios | **«Calidad del PR»** y **«Seguridad»** | Fusionar con pruebas, Sonar, secretos o dependencias en rojo |
| Borrado de `main` | Bloqueado | Perder la rama por accidente |
| Force push a `main` | Bloqueado | Reescribir el historial |
| Excepción (bypass) | Rol de administrador, **solo mediante un PR** | Un push directo no se puede saltar: solo se puede fusionar un PR sin aprobación en una emergencia, y queda registrado |

## Decisiones y por qué

- **Checks agregados, no sueltos.** Se exigen los dos checks agregados porque ellos mismos fallan si cualquier control interno falla, se omite o se cancela. Así un control nuevo entra al sistema sin tocar la regla.
- **No se exige «rama al día» (`strict`).** Con tres personas en paralelo obligaría a rehacer los checks tras cada fusión ajena. Como el historial es lineal, el rebase previo ya se exige de hecho. Revisar si aparecen fusiones que rompan `main`.
- **1 aprobación con bypass de administrador.** La constitución pide al menos una aprobación. `mpguallo` y `rafapalacios5` tienen permiso de escritura, así que pueden aprobar los PR del líder y a la inversa. El bypass solo existe para que una ausencia prolongada del equipo no bloquee el repositorio; si se usa, debe justificarse en el PR.
- **Sin exigir checks inexistentes.** Los checks de preview, E2E contra un entorno y staging no se exigen: no existen por la decisión de [alcance local](alcance-local.md).

## Cómo se comprobó

Prueba real de rechazo en una rama desechable con una regla idéntica (para no arriesgar `main`): un push directo, un force push y un borrado fueron rechazados por GitHub. Detalle en [main-protection.md](../evidence/main-protection.md).

## Pendiente

- Que las colaboradoras confirmen que aprueban los PR en un tiempo razonable; si no, valorar bajar a 0 aprobaciones **con una enmienda**, no en silencio.
- Cuando existan el entorno de preview y el E2E contra un entorno, añadirlos como checks obligatorios (T047).
- Proteger las ramas de release cuando existan.
