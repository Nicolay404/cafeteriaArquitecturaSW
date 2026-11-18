# T030 — SonarQube Cloud y puerta de calidad (puerta A2)

2026-11-18. El proyecto lo importó el líder desde su cuenta de GitHub; las consultas son a la API pública de Sonar (el proyecto es público), sin token.

## Proyecto

| Dato | Valor |
|---|---|
| Proyecto | `Nicolay404_cafeteriaArquitecturaSW` |
| Organización | `nicolay404-talenttrack` |
| Visibilidad | Pública |
| Quality Gate | «Sonar way» |
| Análisis | Desde GitHub Actions (job «SonarQube Quality Gate»); el análisis automático de Sonar debe permanecer **apagado** |

La clave de organización es la que devolvió la API de Sonar y figura en `proyecto/sonar-project.properties`; una suposición anterior (`nicolay404`) habría hecho fallar el análisis.

## Umbrales aplicados al código nuevo (lo que informa el PR #4)

| Condición de Sonar | Umbral | Constitución VI |
|---|---|---|
| Calificación de fiabilidad del código nuevo | peor que A bloquea | 0 bugs nuevos, calificación A |
| Calificación de seguridad del código nuevo | peor que A bloquea | 0 vulnerabilidades nuevas, calificación A |
| Calificación de mantenibilidad del código nuevo | peor que A bloquea | Calificación A |
| Cobertura del código nuevo | menor que 80 % bloquea | ≥ 80 % |
| Duplicación del código nuevo | mayor que 3 % bloquea | < 3 % |
| Puntos sensibles de seguridad revisados | menos del 100 % bloquea | 100 % revisados |

Los umbrales coinciden con la constitución. Sonar expresa «0 bugs / 0 vulnerabilidades» mediante la calificación A; `scripts/ci/quality-gate.ts` lo documenta y prueba con los mismos números.

## Credenciales y decoración

- El token vive solo como secreto de GitHub `SONAR_TOKEN` (nunca en el repositorio ni en el chat). Se creó como token personal del líder; **su caducidad debe revisarse** porque, al vencer, el análisis dejará de correr y el PR quedará bloqueado (comportamiento deseado, pero hay que renovarlo).
- Sonar decora el PR con el check «SonarCloud Code Analysis», además del job «SonarQube Quality Gate».

## Negativas comprobadas

| Caso | Resultado real |
|---|---|
| Sin `SONAR_TOKEN` (primera ejecución en GitHub) | El job falló cerrado: «Falta SONAR_TOKEN: … la ausencia no significa aprobado» |
| Cobertura del código nuevo baja (70,7 %) y 2 hallazgos de seguridad | El gate dio ERROR y bloqueó el PR #4; se corrigieron y pasó con 93,3 % y calificación A |

Pendiente para T031: el caso de cobertura insuficiente provocado a propósito en un PR de ensayo, y el de «Sonar caído», que se simula quitando el secreto.

## Límites

- **Cobertura por módulo (95 % en promociones, pedidos y pagos):** el gate de Sonar aplica un único umbral global. El complemento por módulo está implementado y probado en `quality-gate.ts`, pero no está conectado a Sonar porque esos módulos aún no tienen lógica. Debe conectarse cuando la tengan.
- Sonar analiza solo `proyecto/`; los scripts de CI de la raíz (`scripts/ci/`) quedan fuera del análisis.
