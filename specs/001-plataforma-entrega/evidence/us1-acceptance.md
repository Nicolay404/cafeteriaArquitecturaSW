# T034 — auditoría de aceptación de US1 (integrar con controles automáticos)

2026-11-18. Cada escenario se contrasta con una ejecución real en GitHub, no con un archivo de configuración. Resumen de los ensayos en [us1-controls.md](us1-controls.md).

## Escenarios de aceptación

| # | Escenario | Estado | Evidencia |
|---|---|---|---|
| 1 | Commits con formato correcto, que compilan y pasan las pruebas: todos los controles pasan y se puede integrar tras una aprobación | **Probado** | PR #4 (13 commits) con 11 checks en verde, fusionado **antes** de activar la protección de `main`. Un PR fusionado bajo la regla (con su aprobación) aún no existe: lo hará el #11 (ver límites) |
| 2 | Commit intermedio que no compila: se bloquea e indica qué commit falla | **Probado** | PR #6: bloqueado con el SHA `74a7164` y el error de TypeScript, con la cabeza verde |
| 3 | Cobertura del código nuevo bajo el umbral: se bloquea y muestra las métricas | **Probado** | PR #7: Sonar `new_coverage` 0,0 % frente a 80 %; además el PR #4 llegó a mostrar 70,7 % antes de corregirse |
| 4 | Secreto o dependencia con vulnerabilidad crítica: se bloquea | **Probado** | PR #8 (Gitleaks) y PR #9 (OSV) |
| 5 | Mensaje de commit inválido: aviso inmediato antes de compartirlo | **Probado en local**; en GitHub también bloquea | Hook `commit-msg` probado con commits reales en un clon temporal (T025); PR #5 lo detecta en el pipeline |

## Criterios de éxito

| Criterio | Estado |
|---|---|
| FR-001–008 (controles y su bloqueo) | Cubiertos por los escenarios anteriores |
| FR-003 (protección de `main`) | **Cubierto**: ruleset activo y rechazo real de push directo, force push y borrado ([main-protection.md](main-protection.md)) |
| SC-001 (resultado en menos de 15 min) | **Cumplido** para los controles propios: 4 min 31 s con 13 commits ([ci-timing.md](ci-timing.md)). Falta la parte de preview/E2E (T048) |
| SC-002 (100 % de los commits de `main` válidos y verdes) | **No se puede afirmar todavía.** El historial anterior a los hooks incluye 6 commits sin alcance ni formato exigido, con coautor. Los commits nuevos sí se verifican uno a uno |
| SC-003 (100 % de lo integrado pasó el umbral) | **Cumple desde que existe el gate.** Los commits anteriores a T028 no pasaron Sonar |

## Sin éxito por omisión

- Un job que falla vuelve rojo su check agregado (ensayos #5 a #9).
- Sonar sin token **falla cerrado** (primera ejecución real).
- El agregado trata también «omitido» y «cancelado» como fallo en el script, pero **no se provocó** esa situación.

## Límites y pendientes honestos

1. **Fallo intermitente (FR-008 y el caso límite del spec): resuelto.** El detector está conectado a los checks agregados y se probó de punta a punta en GitHub (PR #12): un reintento verde que ocultaba un fallo anterior queda bloqueado con la causa original. Pendiente de fusionar en `main` (ver el PR de seguimiento).
2. **Una aprobación obligatoria** está configurada y las colaboradoras tienen permiso para aprobar, pero **no se ejercitó en un caso real**. El primer PR que se fusione bajo la regla (el #11) lo demostrará.
3. **Cobertura del 95 % en promociones, pedidos y pagos:** no está conectada a Sonar, y esos módulos aún no tienen lógica.
4. **OSV tiene una excepción temporal** hasta el 2026-12-18 para tres alertas de herramientas de desarrollo.
5. **Preview, E2E contra un entorno y staging** (partes de US2) quedan fuera por el alcance local.
6. Estos resultados son del autor y de la infraestructura gratuita de GitHub; no sustituyen la revisión del equipo.

## Veredicto

US1 está **cumplida en sus escenarios 1 a 5** y el hueco del fallo intermitente quedó resuelto y probado. Queda un hueco de funcionalidad, no de configuración: la cobertura del 95 % por módulo crítico, que espera a que esos módulos tengan lógica.
