# Línea base de seguridad y datos de la plataforma — T021

**Estado:** propuesto, pendiente de revisión del equipo · **Fecha:** 2026-11-18 · **Base:** rama `feature/spec-1`, commit cc9ba65 · **Alcance:** la superficie que existe hoy (T001–T020), solo en local.

Este documento registra amenazas iniciales, una revisión orientativa de la superficie contra OWASP ASVS nivel 2, el inventario de datos y el Constitution Check documental. **No certifica nada**: no hay nube, identidad, pagos ni datos de clientes, y no se ha ejecutado una auditoría formal ASVS ni un pentest. Cada afirmación remite a una medición hecha en esta sesión o a evidencia previa; lo que no se midió figura como pendiente.

## 1. Superficie existente

| Elemento | Qué expone | Cómo se midió |
|---|---|---|
| API Nest (`apps/api`) | `GET /health` (200/503) y `GET /health/live`; cuerpo solo `status` y `version`; `Cache-Control: no-store`. Cualquier otra ruta o método responde 404. Escucha en **0.0.0.0:3001**. | Peticiones reales a la API compilada; `Get-NetTCPConnection` |
| Web Next (`apps/web`) | Página de inicio estática y `GET /api/health` (proxy). Escucha en 127.0.0.1:3000 con `next start -H 127.0.0.1`. | Idem |
| Proxy de salud | Solo el origen configurado en el servidor; sin redirecciones (`redirect: 'error'`), sin URL, cabecera ni cuerpo del cliente; rechaza credenciales/ruta/consulta en el origen; devuelve solo `status` y `version`. | Código y 9 pruebas web (T014) |
| Worker (`apps/worker`) | Sin puerto. Publica/consume un mensaje técnico y escribe un heartbeat en Redis (`cafeteria:<env>:worker:heartbeat:<id>`, TTL 30 s, solo versión y fecha). | Código y pruebas (T012, T017) |
| Compose local | Postgres, Redis, RabbitMQ (AMQP y gestión) y Mailpit, todos en `127.0.0.1`; imágenes fijadas por digest. | `compose.yaml`, T007 |
| Secretos | Solo `proyecto/.env.example` (credenciales de pruebas locales, rotuladas como no reutilizables). `.env` y `.env.*` ignorados. Un barrido de patrones de claves (privadas, AWS, GitHub, Stripe, Slack, Google) en lo versionado no dio coincidencias. | `git grep`, `git ls-files` |
| Dependencias | `pnpm audit --prod`: «No known vulnerabilities found». Sin escaneo de imágenes ni de secretos en CI todavía (T028). | Ejecución de hoy |

## 2. Amenazas iniciales

| # | Amenaza (STRIDE) | Componente | Control actual | Brecha / acción |
|---|---|---|---|---|
| A1 | SSRF mediante el proxy de salud (manipulación del destino) | `/api/health` | Destino fijo desde la configuración; sin redirecciones; el origen se valida | Ninguna conocida. Mantener la prueba cuando se añadan más proxys |
| A2 | Fuga de información por errores o cabeceras (divulgación) | API y web | El cuerpo de salud no incluye hosts, URLs ni credenciales (probado); los logs de dependencia solo nombran el servicio | **H-01:** `X-Powered-By: Express` y `X-Powered-By: Next.js` revelan el framework |
| A3 | Falta de cabeceras de seguridad del navegador | Web y API | Ninguna configurada | **H-02:** sin CSP, `X-Content-Type-Options`, `Referrer-Policy`, política de frames ni HSTS (este último lo termina el proveedor con TLS) |
| A4 | Exposición de red de la API en el equipo del desarrollador | API | La respuesta es mínima y sin escrituras | **H-03:** la API escucha en todas las interfaces; en local queda accesible desde la red. Hace falta `0.0.0.0` en contenedor, no en desarrollo |
| A5 | Denegación de servicio por sondeos de salud (DoS) | API | Tiempos acotados (≤3 s en total), conexiones de vida corta, sin escrituras | **H-04:** sin límite de peticiones; el readiness abre conexiones a Postgres, Redis y RabbitMQ por cada petición |
| A6 | Credenciales por defecto o filtradas | Compose, `.env.example` | Solo loopback; rotuladas locales; `.env` ignorado; `requireLocal` impide usar `infra:check` fuera de `APP_ENV=local` y de hosts locales | Los secretos reales se resolverán por entorno en T043/T044. Sin escáner de secretos hasta T028 (**H-05**) |
| A7 | Cadena de suministro (dependencias y imágenes) | pnpm, Compose | Lockfile congelado; versiones exactas; política de edad mínima de pnpm; imágenes por digest; auditoría de hoy limpia | **H-05:** sin OSV, Trivy ni Dependabot hasta T028 |
| A8 | Suplantación y escalada de privilegios | Todo | No existe identidad, sesión ni rol: ningún recurso protegido | Se aborda en el Spec #2. No se implementa aquí |
| A9 | Manipulación del broker o de Redis por quien llegue a ellos | RabbitMQ, Redis | Loopback y credenciales locales; en la nube, red privada (plan §2) | La consola de gestión (15672) y la interfaz de Mailpit (8025) no tienen autenticación propia en local; aceptable solo en loopback |
| A10 | Repudio y falta de trazabilidad | Plataforma | Logs JSON sin PII para los eventos del worker y de salud | Sin auditoría de acciones; no hay acciones que auditar todavía |

## 3. Revisión orientativa contra ASVS nivel 2 (superficie actual)

Se revisaron áreas, no requisitos numerados: no se aplicó la lista completa ni se fijó una versión de ASVS. El resultado dice «cumple» solo cuando hay evidencia.

| Área | Estado | Evidencia o motivo |
|---|---|---|
| Arquitectura y límites de módulos | Cumple en lo existente | Lint de fronteras con pruebas (T019) |
| Validación de entrada | Cumple en lo existente | No hay entradas de usuario salvo el proxy, que ignora toda entrada del cliente; la configuración se valida por nombre sin volcar valores (T006) |
| Gestión de errores y registro | Parcial | Sin detalles internos ni secretos en respuestas y logs (probado). Sin registro centralizado ni correlación todavía (T072) |
| Protección de datos | Cumple en lo existente | No hay datos personales (sección 4). Sin cifrado en reposo que evaluar |
| Comunicaciones | No evaluable aquí | Todo es HTTP/AMQP local en loopback; TLS lo aportan Vercel y Render y se ensaya en T044 |
| API | Parcial | Solo `GET`; 404 para el resto; sin límite de peticiones (H-04); sin esquema formal de errores |
| Configuración y cabeceras | **Brecha** | H-01, H-02, H-03 |
| Autenticación, sesión y control de acceso | No aplica todavía | No existen; se evalúan en el Spec #2 |
| Criptografía | No aplica todavía | No se almacena ni se transmite información sensible; Argon2id y cifrado por columna llegan con Identidad y Clientes |
| Código malicioso y dependencias | Parcial | Auditoría limpia hoy; sin escaneo automático (T028) |

## 4. Inventario de datos personales — sin recolección

Ninguna tabla, clave, cola ni log de la plataforma contiene datos personales hoy. Qué hay y por qué no cuenta:

| Dato | Dónde | ¿Personal? | Retención |
|---|---|---|---|
| UUID de instancia del worker, versión y fecha | Redis (heartbeat) | No: identifica un proceso | TTL 30 s, se borra al cerrar |
| Credenciales de pruebas locales | `.env.example`, Compose | No: valores públicos, solo locales | — |
| Nombre de dependencia caída | Logs JSON del worker y de salud | No | Solo consola local |

Quedan **fuera de este inventario y sin recolectar**: los datos de clientes (Spec #2, que debe declarar finalidad y plazo por cada dato) y la actividad del equipo de desarrollo (US5; exige T067: finalidad, retención de 90 días en detalle y 12 meses agregada, aviso previo y acceso restringido, antes de extraer nada real). Constitución III: cada dato personal nuevo se añade aquí con su finalidad y plazo.

## 5. Límites de CU003 (gestión de menús) y del diagrama

La plataforma **no implementa CU003 ni ningún caso de uso de negocio**: no hay tablas, controladores, formularios ni datos de menús o productos. Los nueve módulos son esqueletos con su `index.ts` (T008). Lo decidido en el plan §1 se mantiene: menús y productos pertenecen a Catálogo (esquema `catalog`) y Admin es un actor, no un módulo dueño de tablas ajenas. Siguen abiertas para los specs de Catálogo y Promociones: la correspondencia de Cocineros con personal, la semántica de Oferta frente a Promociones y la abstracción de versiones y publicación; el CAPTCHA del registro se revisa en el Spec #2. Ninguna de esas decisiones se toma aquí.

## 6. Constitution Check documental

Evaluación de lo que existe, no cumplimiento probado del producto.

| Principio | Estado hoy | Pendiente |
|---|---|---|
| I Accesibilidad AAA | Inicio básico sin violaciones automáticas de axe; teclado, foco y reflow probados (T018) | Contraste por estados, lector de pantalla y revisión humana (T039–T040, T083) |
| II Seguridad | Sección 2–3: controles de superficie y 5 hallazgos abiertos | Resolver H-01…H-05; MFA, roles y tarjetas fuera de alcance |
| III Datos personales | Inventario sin datos personales | Spec #2 y T067 |
| IV Escalabilidad y consistencia | Servicios sin estado; sin pedidos ni pagos | Outbox e idempotencia en sus specs |
| V Monolito modular | Lint de fronteras con pruebas | Permisos de base de datos cuando existan repositorios |
| VI Calidad verificada | Pruebas unitarias, de integración real, E2E y smoke; cobertura LCOV local | Quality Gate de Sonar y umbrales por módulo (T027–T030) |
| VII Commits atómicos y reversibles | Commits atómicos con Conventional Commits y verificados; sin hooks ni validación en CI | Husky, commitlint y comprobación commit a commit (T025–T026) |
| Plataforma | Sin Python; despliegue solo por pipeline, aún sin pipeline | Vercel, Render, GHCR y autodeploy desactivado (T043–T044) |

## 7. Hallazgos abiertos

| ID | Hallazgo | Riesgo | Propuesta | Tarea |
|---|---|---|---|---|
| H-01 | `X-Powered-By` en API y web | Bajo | Desactivar la cabecera en Nest y en Next, con prueba | Endurecimiento (nuevo) |
| H-02 | Sin cabeceras de seguridad | Medio | Definir la política mínima (CSP compatible con el inicio actual, nosniff, referrer, frames) y probarla; revisar con la UI aprobada | Endurecimiento y T038 |
| H-03 | API escucha en `0.0.0.0` en desarrollo | Bajo en local | Host configurable: `127.0.0.1` por defecto en desarrollo y `0.0.0.0` en contenedor | Endurecimiento |
| H-04 | Sin límite de peticiones en readiness | Bajo ahora | Valorar caché corta del resultado o limitación; documentar la decisión | T049 y revisión de carga |
| H-05 | Sin escaneo automático de secretos, dependencias ni imágenes | Medio | Workflows de Gitleaks, OSV, Trivy y CodeQL **preparados en T028, aún sin ejecutar en GitHub**; Gitleaks, Trivy y OSV ya se ejecutaron a mano (historial sin fugas, Trivy limpio). Imágenes: T042 | T031, T042 |
| H-06 | OSV detectó 2 vulnerabilidades altas (picomatch ≤ 4.0.7, ReDoS, **sin parche publicado**) y 4 medias (glob y minimatch) en dependencias de **desarrollo** (Jest, Vite, Testcontainers) | Bajo: no se despliegan | **Excepción temporal aprobada por el líder el 2026-11-18, caduca el 2026-12-18**, escrita en `osv-scanner.toml` con motivo y limitada a esas tres alertas. Pendiente de confirmar con el resto del equipo (la constitución II dice que las altas bloquean). Al caducar, OSV vuelve a bloquear | Revisar antes del 2026-12-18 |

Los hallazgos H-01 a H-04 siguen **abiertos** y H-05/H-06 dependen de la ejecución real del pipeline (T031); ninguno se corrigió en T021. H-01 a H-03 son cambios pequeños y verificables que pueden entrar como commits separados antes del cierre del Spec #1; el equipo decide si se hacen antes de fusionar H0 o después.

## 8. Qué no certifica este documento

Ni cumplimiento de ASVS L2, ni ausencia de vulnerabilidades, ni seguridad de la nube (Vercel, Render, GHCR, redes privadas, secretos de entorno), ni identidad, ni pagos, ni LOPDP del producto. Es un punto de partida para revisar con las tres personas y actualizar en cada spec.
