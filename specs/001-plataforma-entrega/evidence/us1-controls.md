# T031 — ensayo real de los controles de US1 en GitHub

2026-11-18. Seis PR de ensayo en borrador contra `main` ya protegida, abiertos desde ramas `ensayo/t031-*` con **fixtures sintéticos**: ningún secreto es real. **No se fusionaron** y su rama se borró al terminar. Cada negativo cambia una sola cosa para atribuir el fallo a un único control.

| PR | Caso | Resultado de GitHub | Causa visible en el PR |
|---|---|---|---|
| #10 | PR solo de documentación (positivo) | **11 checks en verde** | — |
| #5 | Mensaje de commit inválido («arreglos varios») | «Cada commit…» y «Calidad del PR» en rojo; los demás en verde | Commit `d54aa7e`, etapa **mensaje**: `subject-empty`, `type-empty`, `scope-empty` |
| #6 | Commit intermedio roto, con la cabeza verde | «Cada commit…» y «Calidad del PR» en rojo; **«Lint, tipos, pruebas y build» en verde** | Commit `74a7164`, etapa **comprobación**: `scripts/zz-ensayo-roto.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'`. El commit `e71b1c9` que lo corrige pasa |
| #7 | Código nuevo sin cobertura | «SonarQube Quality Gate», «SonarCloud Code Analysis» y «Calidad del PR» en rojo | Sonar: `new_coverage` = **0,0 %**, umbral menor que 80 % |
| #8 | Secreto sintético (clave AWS y token de GitHub aleatorios) | «Gitleaks» y «Seguridad» en rojo | Reglas `aws-access-token` y `github-pat` en `proyecto/tests/fixtures/zz-ensayo-secreto-sintetico.txt` |
| #9 | Dependencia con vulnerabilidades (`lodash@4.17.20`) | «OSV» y «Seguridad» en rojo | `GHSA-r5fr-rjxr-66jc` (8,1), `GHSA-35jh-r3h4-6jhm` (7,2) y 2 medias; corregidas en lodash 4.17.21 o posterior |

## Lo que demuestran

- **El caso clave del requisito FR-002 (#6):** la cabeza del PR era correcta y el job que la prueba pasó en verde, pero el PR se bloqueó por un commit intermedio. Un control que solo mirara la cabeza lo habría dejado pasar.
- **Cada control bloquea por su causa y no por otra:** en cada negativo, el resto de controles siguió en verde.
- **Los checks agregados «Calidad del PR» y «Seguridad» reflejan el fallo** de cualquier control interno, que es lo que exige la protección de `main`.
- **Con `main` protegida**, un PR con cualquiera de esos checks en rojo no se puede fusionar (la regla exige ambos agregados).

## Hallazgo: Trivy no detectó lo que OSV sí

En el ensayo #9, **Trivy pasó** con el mismo `lodash` vulnerable. Se comprobó en local: Trivy reconoce y escanea `pnpm-lock.yaml` (tipo `pnpm`, `lockfileVersion 9.0`), pero con su base de datos no califica esas alertas como altas o críticas, mientras que OSV sí. No es un punto ciego del escáner, sino una diferencia entre bases de datos de vulnerabilidades. **Conclusión:** OSV es el control de dependencias que manda; Trivy lo complementa (secretos, configuración y, más adelante, las imágenes de contenedor). No se debe quitar OSV.

## Qué no se probó

- **Sonar caído**: se comprobó en la primera ejecución real (sin `SONAR_TOKEN` el job falló cerrado), no en esta tanda.
- Un control **omitido o cancelado** en el check agregado: el script lo trata como fallo, pero no se provocó en estos ensayos.

## Rastro y limpieza

Los PR #5 al #10 se cerraron sin fusionar y sus ramas se borraron. GitHub conserva los commits por su identificador durante un tiempo; los valores del fixture de secretos son aleatorios y no válidos, pero Gitleaks los trata como reales.

## Ensayo del fallo intermitente (PR #12, cerrado sin fusionar)

El hueco que dejó la primera tanda se cerró con `proyecto/scripts/ci/check-attempts.ts`, conectado a los checks agregados «Calidad del PR» y «Seguridad». Cuando un run se reintenta, compara los jobs de **todos** los intentos con la API de Actions; solo corre si `run_attempt` es mayor que 1, así que no añade tiempo al caso normal.

**Ensayo real:** un paso simulado fallaba solo en el intento 1.

| Intento | Resultado |
|---|---|
| 1 | `Lint, tipos, pruebas y build` **falló** en el paso «Fallo intermitente simulado (ENSAYO)»; el agregado quedó en rojo |
| 2 (`gh run rerun --failed`) | **Todos los controles pasaron**, incluido el que había fallado. Aun así, «Calidad del PR» quedó **en rojo**: «BLOQUEADO: hay controles que fallaron y pasaron al reintentar» y, como causa original, «el intento 1 falló (paso «Fallo intermitente simulado (ENSAYO)») y un reintento pasó» |

Sin el detector, ese PR habría quedado verde y fusionable. **Falla cerrado:** una API sin respuesta, sin permiso o con configuración inválida bloquea. Las pruebas unitarias (19) cubren intermitente, fallo persistente, controles cancelados u omitidos, varios controles a la vez, errores de la API y variables de entorno incorrectas; la mutación de la comparación, del rango de intentos y de la condición del primer intento hace fallar las pruebas.

**Límite:** un reintento sin fallos previos (control positivo) se probó con datos simulados, no aún con un run real de GitHub con el detector incluido.
