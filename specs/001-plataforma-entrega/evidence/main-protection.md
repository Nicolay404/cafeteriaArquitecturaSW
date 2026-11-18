# T033 — protección de `main` en Nicolay404/cafeteriaArquitecturaSW

2026-11-18. Aplicada con la API de GitHub (`gh api`) por el administrador del repositorio, tras la autorización explícita del líder. Reglas y motivos en [github-controls.md](../decisions/github-controls.md).

## Estado aplicado

Ruleset «Proteger main», id 27526256, enforcement `active`, objetivo la rama predeterminada. Las reglas efectivas que GitHub informa para `main` (`GET /repos/.../rules/branches/main`): `deletion`, `non_fast_forward`, `pull_request`, `required_linear_history`, `required_status_checks`. Antes no había ningún ruleset ni protección clásica (`Branch not protected`, 404).

## Prueba de rechazo (real, contra GitHub)

Para no arriesgar `main` se creó una rama desechable `zz-prueba-proteccion` en el mismo SHA que `main` (075d4c3) y un ruleset temporal con las mismas reglas y el mismo bypass. Desde un clon temporal apuntando a GitHub:

| Intento | Resultado |
|---|---|
| Push directo de un commit nuevo | **Rechazado**: «Changes must be made through a pull request» y «2 of 2 required status checks are expected» (`push declined due to repository rule violations`) |
| Force push | **Rechazado** (`push declined due to repository rule violations`) |
| Borrado de la rama | **Rechazado** (`push declined due to repository rule violations`) |

La rama siguió en su SHA original. Se borró después el ruleset temporal y la rama. `main` no se tocó (075d4c3 antes y después).

Un primer intento de esta prueba no probó nada: el clon temporal apuntaba por error al repositorio local en vez de a GitHub. Se detectó porque los pushes «funcionaron»; se repitió con el remoto correcto y de él proviene la tabla.

## Límites

- La prueba se hizo sobre una rama equivalente, no sobre `main` mismo, para no arriesgarla; las reglas efectivas de `main` se leyeron de la API y coinciden con las del ruleset de prueba.
- La aprobación obligatoria y el rebase único se comprobarán con el primer PR real que se fusione bajo la regla. Un PR con checks en rojo debe quedar bloqueado: se demostrará con los PR de ensayo de T031 (pendientes de autorización para publicarlos).
- La excepción de administrador no se ejercitó.
