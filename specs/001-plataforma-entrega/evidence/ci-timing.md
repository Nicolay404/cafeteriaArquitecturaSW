# T032 — tiempos de los controles propios de US1

2026-11-18. Medidos con la API de GitHub Actions sobre ejecuciones reales (runner `ubuntu-24.04`, repositorio público). Tiempo total = desde que se crea el primer workflow hasta que termina el último.

## PR con muchos commits de código (PR #4, 13 commits)

| Job | Duración |
|---|---|
| Lint, tipos, pruebas (unitarias e integración con Docker) y build | 3 min 15 s |
| Cada commit es válido y verde por sí solo (13 commits) | 3 min 23 s |
| SonarQube Quality Gate (después del job anterior, que le entrega la cobertura) | 1 min 04 s |
| CodeQL | 50 s |
| OSV | 16 s |
| Trivy | 10 s |
| Gitleaks | 10 s |
| Agregados «Calidad del PR» y «Seguridad» | 5 s cada uno |
| **Total de pared (los jobs corren en paralelo, Sonar tras las pruebas)** | **4 min 31 s** |

## Otros PR

| PR | Total |
|---|---|
| PR de ensayo #10 (1 commit, solo documentación) | 4 min 41 s |
| PR de ensayo #6 (2 commits, uno roto) | 4 min 46 s |

## Lectura frente a SC-001

SC-001 pide conocer el resultado de todos los controles de un PR típico (hasta 10 commits) en **menos de 15 minutos**. Un PR de **13** commits de código tardó **4 min 31 s**: el criterio se cumple con holgura, aunque con más commits que el máximo del criterio. El presupuesto restante, unos 10 minutos, queda disponible para los controles que llegarán (E2E contra un entorno, si se añade).

## Observaciones

- La verificación commit a commit escala bien: 13 commits en 3 min 23 s, unos 15 s por commit de media (los commits de solo documentación cuestan solo el mensaje).
- Un PR solo de documentación **no es más rápido**: los workflows no filtran por ruta, así que corren completos (4 min 41 s). Es una simplificación deliberada para que los checks obligatorios existan siempre.
- No hay caché de dependencias de pnpm en los workflows. Es la optimización pendiente más obvia, pero hoy no hace falta para cumplir SC-001, y añadir caché no debe saltarse la verificación de ningún commit.
- Las cifras son de un runner gratuito de GitHub, con variación normal entre ejecuciones (±30 s en las comparadas).

## Límite

SC-001 completo incluye la parte de preview y E2E contra un entorno (T048). Con el alcance local, esa parte no existe; este documento mide solo los controles propios de US1.
