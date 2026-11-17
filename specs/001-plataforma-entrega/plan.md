# Plan — Spec #1: Plataforma de entrega continua

**Rama comprobada:** `feature/spec-1` · **Fecha:** 2026-11-16 · **Estado:** propuesta técnica; preparación T001–T006/T008 y reorganización verificadas en evidencia. Arranque completo y despliegues sin validar.

Entrada: [spec.md](spec.md), sin modificar. Fuentes leídas: `AGENTS.md`, `.specify/memory/constitution.md` v1.0.0, `promtp.md`, Fase 0 de `ROADMAP.md` y XML de `docs/architecture/cafeteria.drawio`. Prevalece la constitución. El contenido de la plantilla se organiza en las seis secciones solicitadas. Complementan el diseño [research.md](research.md), [data-model.md](data-model.md), [contracts/platform.md](contracts/platform.md) y [quickstart.md](quickstart.md).

## 1. Alcance

Entregar la base reproducible y el flujo de entrega del spec. La demostración mínima incluye una página inicial de cafetería y `/health`, worker técnico e infraestructura local real. La página entra por SC-009; no amplía alcance al catálogo. No construir registro, login, menú dinámico, formularios administrativos, carrito, checkout, cocina, pagos ni promociones. Los dashboards de entrega pertenecen a Grafana, no a pantallas de la cafetería.

| Historia / requisitos | Entrega prevista | Evidencia futura |
|---|---|---|
| US1; FR-001–008 | Commits válidos/verdes, main protegida, flags, guía de migraciones, controles y Quality Gate | PR correcto aceptable; commit intermedio roto, mensaje inválido, cobertura insuficiente y secreto bloquean con causa/SHA |
| US2; FR-009–013, 019 | Preview web/API, E2E/axe, staging automático y secretos separados | URLs, informes y manifiesto; staging conserva N−1 si falla |
| US3; FR-014–017 | Release semántica, aprobación, migración previa, backend antes de frontend, smoke/rollback | Ensayos sin aprobación, migración fallida y smoke fallido; restauración medida |
| US4; FR-005 | Flags runtime, expand/contract y guía de revert | Revert seleccionado pasa CI/staging; compensación conserva datos |
| US5; FR-020–024 | Cinco dashboards, fuentes GitHub/Actions/Sonar, privacidad y alertas | Despliegue visible; revisiones/tests/documentación visibles; acceso individual denegado sin permiso |
| FR-018 | k6 nocturno y antes de festividades, solo staging | Informes de superficie existente; añadir escenarios de pedidos cuando existan |

P1 habilita trabajo inicial; P2/P3 siguen en este diseño y no quedan terminadas por alcanzar SC-009. Producción se ensaya con datos sintéticos y autorización operativa antes de aceptar clientes. Fase 6 conserva la auditoría de lanzamiento; no permite omitir aquí el mecanismo de release/rollback. No afirmar 1 000 pedidos/min ni latencias de menú/checkout sin esos flujos.

### Diagrama y diferencias que requieren revisión

El draw.io existe. Distingue **Cliente**, **Cocineros** y **Admin**. Contiene registro con CAPTCHA, pedidos y **CU003 — Gestión de menús**: un admin registra menús y agrega productos. Muestra `Menus`, `Productos`, `Oferta`, secuencia borde/control/modelo (`indexMenu`, `crearMenu`, `controlMenu`, `modeloMenu`) y paquetes MENU, PRODUCTO, OFERTA, ADMIN, UTILITARIO y PLATAFORMA. Sus placeholders de atributos/métodos no definen campos reales.

| Diferencia | Decisión de este plan | Revisión pendiente |
|---|---|---|
| Spec dice rama `001-plataforma-entrega`; rama autorizada `feature/spec-1` | Conservar rama real y carpeta fijada en `.specify/feature.json` | Corregir metadato en cambio autorizado, sin modificar spec ahora |
| Cocineros frente a «personal» | Actor distinto de Cliente/Admin; correspondencia candidata con personal | Acordar si cocina confirma pagos; no asumir permisos |
| MENU/PRODUCTO separados frente a Catálogo constitucional | Menús/productos pertenecen a Catálogo, esquema `catalog`; Admin es actor | Confirmar trazabilidad CU003 sin módulo Admin propietario de tablas ajenas |
| Oferta ligada a menú frente a Promociones independiente | Reglas/vigencias en Promociones; referencias públicas de Catálogo | Precisar semántica/cardinalidades en futuro, sin tablas de negocio aquí |
| Registro incluye CAPTCHA; RF-01 no lo exige expresamente | No añadirlo a inicio ni contratar proveedor | Revisar requisito/accesibilidad en spec de identidad |
| CRUD/secuencia simplifican versiones, publicación y auditoría | Monolito modular y requisitos prevalecen; diagrama es referencia funcional | Precisar abstracción/actualizar diagrama antes de CU003 |
| Roadmap menciona `frontend-design` | Autoría del equipo; Taste solo revisión según petición actual | Aprobar boceto y documentar decisiones |
| Roadmap inicia dos paneles; US5 exige cinco | DORA/salud primero, completar flujo/calidad/aporte aquí | No cerrar US5 con dos paneles |
| Build en main frente a FR-012 sin reconstrucción | Cada build crea candidato que supera controles y luego se promueve intacto | Revisar identidad tras rebase y demostrar configuración/promoción Vercel |

## 2. Decisiones técnicas

### Contexto técnico y estructura

Monorepo TypeScript con pnpm/Turborepo; Next.js/React en Vercel, NestJS/API y worker Node en Render; Postgres, Redis/Key Value, RabbitMQ y Mailpit local. Sin Python en aplicación. Linux para CI/producción; Windows con Docker Desktop en modo Linux y Linux para desarrollo. Réplica de lectura privada de Render descrita en Blueprint, sin necesitarla para arranque local ni habilitar reportes de negocio.

Implementación fijará versiones exactas compatibles de Node LTS soportado por ambos proveedores, pnpm, TypeScript, Next.js, NestJS y herramientas en `proyecto/.node-version`, `packageManager`, manifiestos y `proyecto/pnpm-lock.yaml`. Imágenes fijadas por versión/digest, nunca `latest`. Bootstrap no pasa hasta registrar matriz y probar instalación congelada. No se afirma compatibilidad de versiones todavía no instaladas.

```text
raíz Git/
  .git/                           # Mismo repositorio
  AGENTS.md, CLAUDE.md, .gitignore, README.md
  .agents/, .claude/, .specify/     # Agentes desde raíz Git
  docs/architecture/cafeteria.drawio
  specs/001-plataforma-entrega/    # Spec, plan, tareas, decisiones y evidencia
  .github/workflows/              # Futuro; permanece en raíz Git
  scripts/ci/                     # Futuro: verify-commits / verify-revert del repo
  proyecto/                      # Raíz del monorepo y cwd de pnpm/Turbo
    apps/{web,api,worker}/
    packages/{config,contracts,ui}/
    tests/{unit,integration,e2e,smoke,load}/
    scripts/                     # env-check actual; infra/db/deploy futuros
    .node-version, .npmrc, .env.example, .dockerignore
    package.json, pnpm-workspace.yaml, pnpm-lock.yaml, turbo.json
    tsconfig.json, eslint.config.mjs, .prettierrc.json, .prettierignore
    infra/compose.yaml           # Pendiente T007; no creado
    infra/observability/         # Futuro
    render.yaml, vercel.json     # Futuros; no creados
```

Estructura objetivo actualizada por reorganización: preparación T001–T006/T008 existente bajo proyecto/. Salud, web funcional, Compose y cloud siguen pendientes según tasks.md. La raíz Git y documentación compartida se conservan; las rutas futuras no representan archivos ya implementados.

Identidad (`identity`), Clientes (`customers`), Catálogo (`catalog`), Promociones (`promotions`), Carrito, Pedidos (`orders`), Pagos (`payments`), Notificaciones y Reportes tendrán esqueletos y exportaciones públicas. No crear tablas/endpoints de negocio. La propiedad adicional de datos se concreta en sus specs. Prohibir imports profundos y acceso a repositorios/esquemas ajenos mediante ESLint y caso negativo. `platform` no será dueño de PII; entre dominios solo contratos públicos/eventos.

Jest para API/worker e integración; Vitest/Testing Library para componentes web; Playwright/axe para E2E. Testcontainers con servicios reales/puertos dinámicos independiente de Compose. SQL parametrizado y migraciones SQL para prueba técnica; no elegir ORM de negocio ahora. Radix o React Aria solo si un componente aprobado lo requiere. Cada dependencia justifica su función.

Servicios sin estado. Flags técnicos en Redis, consultados en runtime con valor seguro desactivado al fallar Redis; cambios mediante herramienta/pipeline autorizado sin redeploy/panel público. Datos y broker solo en red privada Render; Compose expone loopback. Worker sin endpoint público y con señal técnica de actividad verificable. Salud no muestra credenciales ni PII.

### CI y calidad — US1/US2

1. Checkout con historial completo/base PR conocida. Commitlint valida todos los mensajes; Husky `commit-msg` y lint-staged adelantan errores localmente. CI no confía en hooks locales.
2. Recorrer commits en checkout temporal aislado desde la base: instalar con lockfile de cada commit, typecheck, build y tests de paquetes afectados. Cambios raíz/lockfile/config verifican todo. Reportar SHA fallido sin rebase de rama del autor. Caché por lockfile/herramienta, nunca saltarse commits. SC-001: ≤10 commits, controles completos <15 min.
3. Cabeza del candidato: lint/fronteras, formato, tipos, unitarios y Testcontainers. LCOV web/API/worker/integración normalizado, sin duplicar líneas ni generados.
4. SonarQube Cloud propuesto: cobertura nueva ≥80%, ≥95% en promociones/pedidos/pagos cuando tengan lógica; 0 bugs/vulnerabilidades; hotspots revisados 100%; duplicación <3%; A en mantenibilidad/fiabilidad/seguridad. Comprobación bloqueante por módulo si gate global no expresa 95%. Sonar caído/ausente bloquea merge. Documentación pura: controles aplicables y cobertura no aplicable, no 100% ficticio.
5. Gitleaks, OSV/auditoría dependencias, Trivy API/worker y CodeQL. Secretos y vulnerabilidades altas/críticas bloquean. Casos negativos con fixtures públicos sintéticos, nunca secretos reales.
6. Construir candidato/manifiesto; desplegar preview desde ese paquete. Playwright prueba solo inicio/salud, axe cada página existente. No fabricar registro/compra/pagos para cubrir ejemplos generales de `promtp.md`.
7. Check agregado estable solo pasa con controles aplicables, preview y E2E/axe completos. `main` en `Nicolay404/cafeteriaArquitecturaSW`: PR, ≥1 aprobación, sin push directo/bypass ordinario, checks requeridos, rebase/historial lineal con commits individuales. Invalidar aprobación al cambiar código. Cancelar candidatos PR obsoletos; serializar deploy por entorno.

Casos negativos: commit intermedio roto, mensaje inválido, gate insuficiente, secreto/vulnerabilidad controlados, import ilegal y fallo E2E/axe. No integrar fallas en main. Tests inestables bloquean y se registran; reintentar no borra el fallo inicial. TDD obligatorio al incorporar dinero/promociones/pedidos/pagos, sin lógica monetaria ahora.

### Artefactos, entornos y reversibilidad — US2/US3/US4

Candidato = SHA exacto + digests API/worker + hash web + configuración autorizada + migraciones. Nunca tags mutables como identidad. Construir una vez por candidato; promover el artefacto probado sin reconstruir. Si rebase cambia SHA o main construye de nuevo conforme a constitución, es un candidato nuevo que debe pasar controles nuevamente antes de staging y promoción intacta a producción. No confundirlo con el del PR.

Vercel: propuesta prebuilt y configuración pública runtime desde mismo origen; no compilar `NEXT_PUBLIC_API_URL` diferente por entorno. Web lee `API_BASE_URL` en servidor y solo necesita proxy técnico de salud ahora. Guardar hash de `.vercel/output`. [Promoción Vercel](https://vercel.com/docs/deployments/promoting-a-deployment) tiene consideraciones de variables preview/producción; [deploy](https://vercel.com/docs/cli/deploy) documenta prebuilt. **Ensayo externo obligatorio:** mismos hashes, API correcta y secretos separados sin rebuild. Si cambiar entorno exige reconstruir/modificar paquete, FR-012 bloquea esa ruta y exige revisar ADR con equipo; mencionar `--prebuilt` no lo demuestra. Taste no obliga exportación estática.

Render: imágenes GHCR por digest, configuración runtime y migración previa. Soporta [imágenes preconstruidas](https://render.com/docs/deploying-an-image); [rollback por tag](https://render.com/docs/rollbacks) puede resolver otra imagen: conservar digest. Blueprint versiona servicios, región, disco RabbitMQ, réplica/backups, healthchecks y secretos por referencia. Desactivar autodeploy con sintaxis soportada validada al implementar, sin copiar a ciegas booleanos antiguos. Conservar manifiesto previo e imágenes, sin depender solo de retención del proveedor.

| Entorno | Activación/datos | Prueba |
|---|---|---|
| Preview | Pipeline PR, sintéticos aislados y secretos de prueba | URLs web/API, identidad/tests; limpieza al cerrar PR |
| Staging | Pipeline main; sintéticos hasta disponer de producción anonimizada | Migración técnica/web/API/worker; SC-004 <20 min desde merge |
| Producción | Release-please/tag/changelog, candidato staging y aprobación Environment `production` | Migración, backend/worker primero, web después, smoke y sondeo continuo |

Fallback del spec: preview web contra staging si no hay backend PR, claramente rotulado. **No demuestra el backend del PR.** Serializar ensayos de backend candidato en staging con exclusión mutua/datos aislados y restaurar después staging de main. Si no puede garantizarse identidad/exclusión, US2 bloqueada hasta contar con preview aislado.

Migración con lock/versión/checksum antes de activar backend; si falla, N−1 sigue atendiendo. Solo tabla técnica sin PII para ensayos. Expand/contract compatible N/N−1. Migraciones aplicadas no se borran/revierten: compensar con nueva migración conservando datos. Funciones incompletas ocultas y denegadas mediante flags runtime.

Producción serializada sin cancelar release activa. Registrar versiones previas web/API/worker antes de migrar. Smoke fallido restaura componentes por identidad anterior, repite smoke y notifica, sin deshacer datos destructivamente. Medir SC-005 <5 min desde detección y SC-006 con sondas continuas sin interrupción observada. Si plan/capacidad no permite metas, US3 no pasa. Después revert por PR reconcilia main con producción. SC-007 selecciona commits al azar en copia desechable y prueba CI/staging, incluido fixture de migración compatible, sin revertir esta rama.

### Métricas y operación — US5

Grafana Cloud y SonarQube Cloud propuestos por defecto del spec, sin cuentas comprobadas. Fuentes GitHub (commits/PR/revisiones/archivos), Actions (duración/resultado/job/artefactos/deploy/rollback), Sonar (gate/cobertura/deuda). Exportador TypeScript con cursor, ventana solapada y deduplicación por evento/ejecución/intento. Eventos durables en Postgres técnico separado del negocio; confirmar envío/reintentar con backoff. Grafana caída no bloquea entrega; recuperar de fuentes/cola durable, nunca solo disco efímero del runner. Worker/cron privado Render consulta fuentes: no abrir Postgres a Actions.

Prometheus/Mimir para métricas de baja cardinalidad, Loki para eventos, anotaciones para releases/incidentes. SHA/persona/PR en datos restringidos, no etiquetas ilimitadas. Logs/trazas OpenTelemetry correlacionados sin PII. Sin certificar observabilidad de pedidos futuros.

| Panel | Definición |
|---|---|
| DORA | Releases productivas correctas/periodo; primer commit→producción; releases con incidente/rollback ÷ total; detección→restauración |
| Flujo | Apertura→merge, primera revisión, tamaño/antigüedad PR |
| Calidad | Cobertura/deuda, gates aprobados, bugs/vulnerabilidades por módulo |
| Salud | Duración por job, éxito main, fallos intermitentes conservados |
| Aporte | PR/revisiones/commits/tests/documentación con igual peso visual, sin puntuación/ranking |

Staging no cuenta como producción. DORA sin releases muestra «sin datos de producción»; SC-009 usa anotación explícita staging. SC-008 mide evento→panel <1h. Alertas propuestas: evaluación cada 5min; main rojo inmediato; gate <95% en últimas 20 ejecuciones, mínimo 5; fallos de cambios >20% en 7 días, mínimo 5 releases. Sin muestras: sin datos. Equipo revisa umbrales/canal y prueba recepción; no enviar mensajes desde este plan.

Inventario de actividad: ID GitHub, autor/revisor, timestamps/referencias; finalidad mejora/visibilidad. Retención propuesta detalle 90 días/agregados equipo 12 meses, pendiente de aprobar antes de recopilar. Sin emails/contenido de comentarios innecesarios. Restringir panel **y consultas/fuentes** individuales al grupo aprobado; probar cuenta denegada, informar equipo y documentar acceso/rectificación/eliminación. Sin portal de derechos de clientes ahora.

### Constitution Check previo y posterior al diseño

Evaluación documental: diseño trazable sin excepciones propuestas, no cumplimiento probado. Complejidad/violaciones justificadas: ninguna. Las puertas conservan evidencia pendiente antes de cerrar implementación/release.

| Puerta | Antes → después del diseño | Evidencia pendiente |
|---|---|---|
| I AAA | Inicio aplica → criterios §5 | Contraste/axe/teclado/lector/responsive |
| II Seguridad | Plataforma aplica → permisos/secretos/escaneos | Modelo de amenazas y revisión ASVS L2 de superficie; tarjetas/MFA/roles de negocio fuera de alcance |
| III Datos | Actividad equipo aplica → inventario/retención/permisos | Aprobación/información previa/prueba acceso; sin PII clientes |
| IV Consistencia | Servicios sin estado → flags/telemetría durables | Reinicios/reintentos; outbox/idempotencia negocio exigibles en sus specs |
| V Modularidad | Monolito requerido → límites definidos | Lint y prueba negativa |
| VI Calidad | Tests obligatorios → unitarios/integración real/E2E/axe/gate | Informes reales/umbrales; no certificar por YAML |
| VII Reversibilidad | Requerida → flags/expand-contract/runbook | Revert/migración fallida/rollback medido/commits verdes |
| Plataforma | Stack conservado → solo pipeline | Permisos/región/autodeploy desactivado/ensayo FR-012 |

Bloqueo de promoción, excepción AAA o cambio tecnológico requiere revisión documental antes de continuar la parte afectada, sin excepción tácita. Aprobación visual/accesos pendientes son condiciones de ejecución, no gates probados.

## 3. Verificación desde clon limpio

[quickstart.md](quickstart.md) define comandos destino/resultados. **Estado al planificar originalmente:** no se habían ejecutado instalación ni tests. Después se verificó preparación T001–T006/T008 y reorganización en proyecto/; consultar evidence/t001-t008.md y evidence/workspace-reorganization.md. Arranque, build de aplicaciones, Compose y cloud siguen sin validar. Solo se comprobó documentación/rama. `setup-plan.sh --json` resolvió esta carpeta/copió plantilla; reportó BRANCH `001-plataforma-entrega` porque `SPECIFY_FEATURE` tiene ese valor. `git branch --show-current` confirmó `feature/spec-1` antes/después, sin cambiar rama.

Bootstrap incluye versiones exactas, ejemplo local completo, carga explícita de entorno y validación sin imprimir valores. Lockfile congelado; sin herramientas globales accidentales ni `.env` privado del autor. Docker/descargas necesitan conectividad pública inicial, no cuentas de producción.

| Verificación local posterior | Resultado esperado |
|---|---|
| Clon nuevo/versiones | Matriz fijada, lockfile intacto |
| Copiar ejemplo/instalar/`pnpm env:check` | Variables completas, ausentes fallan sin volcar valores |
| Compose/`pnpm infra:check` | Salud y SELECT técnico, Redis write/read/delete, Rabbit publish/consume con ID |
| `pnpm dev` y peticiones | Página renderizada, `/health` 200; dependencia caída produce 503 readiness y recupera |
| Lint/formato/tipos/unitarios/integración/build | Informes, Testcontainers real |
| Playwright/axe/revisión manual | Foto/ancla/salud, axe limpio y evidencia manual AAA |
| Reinicios/cambio flag | Persiste/cambia sin deploy/falla seguro |
| Parada y segundo arranque | Cierre limpio, sin borrar volúmenes por defecto |

Registrar SHA/fecha/SO/comando/resultado/enlaces en `evidence/`, sin secretos. SC-001–003/007 requieren historial/checks reales; SC-004–006/008–009 proveedores: local no los valida. Carga solo staging, nunca clientes productivos.

## 4. Dependencias externas

Accesos **sin comprobar en esta sesión**, no se afirma que las cuentas no existan. Sin secretos en Markdown.

| Acceso/decisión por confirmar | Bloquea | Cómo comprobar después |
|---|---|---|
| Admin repo destino/rulesets/Actions/GHCR/environments con revisores | US1/3 | PR roto bloqueado/push directo denegado/release sin aprobación no despliega |
| Vercel proyecto/plan staging/token CI/restricción deploy personal ordinario | US2/3, FR-011/012 | Autodeploy apagado/permisos efectivos/preview/mismo hash con API y secretos correctos sin rebuild |
| Render workspace/plan/previews/pre-deploy/token/lectura GHCR | US2/3 | Blueprint/digest real; migración fallida conserva N−1; rollback worker/API |
| Región común/red privada/persistencia/backups/réplica | Infra | Región de cómputo, conectividad privada, rechazo público a datos/broker |
| Sonar proyecto/análisis PR/token/admin gate | US1 | PR decorado/umbrales completos; caída bloquea |
| Grafana/Mimir/Loki/fuentes/tokens/grupos | US5 | Evento <1h, recuperación sin duplicados, cuenta sin permiso denegada |
| Canal alertas/responsable operativo | US2/3/5 | Recepción en ensayos main/staging/rollback |
| Presupuesto/capacidad/aprobador production | SC-005/006 | Restauración <5min y sondas continuas en ensayo sintético |
| Fotos/licencias/fuentes/textos/boceto aprobado | UI | Licencias/atribución y aprobación antes de implementar |
| Retención/acceso individual | Datos US5 | Inventario aceptado/información previa/permisos y derechos probados |

RabbitMQ privado autogestionado en Render es propuesta compatible con constitución. CloudAMQP aparece como alternativa en requisitos/roadmap, pero no se adopta automáticamente: si contradice red privada exige ADR/enmienda. Costes/planes/disponibilidad no validados. Calidad/seguridad fallan cerrado; métricas recuperan sin bloquear entrega.

## 5. Dirección visual

**Propuesta, no decisión aprobada:** carta editorial contemporánea de cafetería; título con personalidad/cuerpo legible, café/crema solo en pares ≥7:1. Mobile-first: nombre/categoría, texto breve español y foto real aprobada de café/producto/local. Acción principal visible y jerarquía resistente al aumento de texto; escritorio amplía relación texto/foto sin agregar flujos.

Acción candidata **«Conocer la cafetería»**, ancla a contenido real breve en la misma página, sin ruta nueva. Si falta contenido verificable, equipo resuelve acción/texto antes de implementar. No presentar «Pedir», «Comprar» o «Ver menú» como funcionales. Sin formularios/reseñas/promociones/catálogo de muestra/cifras inventadas ni detalles del pipeline en producto.

Las tres personas aportan/eligen referencias; una prepara boceto propio móvil/escritorio, otra revisa accesibilidad y equipo aprueba composición/tipos/colores/fotos/textos **antes de UI**. Registrar referencias/razón, enlace/exportación y aprobación en `decisions/visual-direction.md`; autor/licencia/fuente/atribución de fotos y fuentes en `decisions/assets.md`. Fallback tipográfico previsto. No generar imágenes/logos/mockups con IA. Stock licenciado no se presenta como foto del establecimiento. Sin material aprobado, UI pendiente.

Existe `.claude/skills/design-taste-frontend/SKILL.md` (tasteskill 2.5.1), no copia en `.agents/skills/design-taste-frontend`. Reutilizar ubicación compartida sin instalar. Después del boceto, revisar jerarquía/composición/bordes/legibilidad/consistencia. No ejecutar selección aleatoria de paletas/layouts, imponer número de fotos/momentos/animaciones, exportación estática ni inventar horarios/precios que el skill permite asumir. Instrucciones actuales/constitución prevalecen; Taste no sustituye aprobación ni AAA.

| Criterio | Evidencia antes de release |
|---|---|
| Contraste texto ≥7:1 | Pares normal/hover/foco/error calculados |
| Teclado/foco | Tab/Shift+Tab/Enter, skip link, orden lógico/foco visible sin trampas; objetivos ≥44×44px |
| Movimiento reducido | `prefers-reduced-motion: reduce`, sin contenido oculto/movimiento imprescindible; propuesta sin animaciones |
| Móvil/escritorio | Capturas 320/390/768/1024/1440px, reflow/texto ampliado sin recortes/solapes/scroll horizontal |
| Semántica | `lang=es`, título/h1/landmarks, nombres accesibles/alt según función |
| Automática/manual | Playwright/axe sin violaciones + NVDA o VoiceOver; axe solo no prueba AAA |
| Autoría | Comparación con boceto aprobado; desviaciones revisadas por equipo |

Sin excepción AAA propuesta. Imposibilidad real requiere justificación en spec y mínimo AA según constitución; este plan no la autoriza ni modifica spec.

## 6. Traspaso al equipo

Markdown versionado conserva contexto para Codex/Claude Code/Antigravity. ADR de stack/límites/promoción/flags/migraciones/telemetría en `decisions/`, con estado propuesto/aceptado, fecha, revisores, alternativas/impacto. Evidencia real en `evidence/README.md` al ejecutar. Sin decisiones importantes solo en chats ni secretos/PII en informes.

Compartir TypeScript estricto, aliases/DTO en `proyecto/packages/contracts`, configuración en `proyecto/packages/config`, tokens semánticos/componentes aprobados en `proyecto/packages/ui`. Globales solo reset/tokens/fuentes; pantalla encapsula estilos sin redefinir tokens por spec. Crear componentes usados, no sistema especulativo.

Revisión cruzada de tres personas, sin asignar otros specs:

- Quien implemente Spec #1 mantiene bases: lockfile/manifiestos/workflows/Compose/Blueprint/Vercel/configuración/contratos/tokens globales.
- Una compañera verifica clon limpio con `quickstart.md`, sin caches/`.env` privados, y versiona resultados/fallas.
- Otra compañera revisa boceto/AAA, contraste/teclado/foco/movimiento reducido/móvil/escritorio/lector. Las tres aprueban dirección antes de UI.

Registrar dueño temporal/rutas/ventana en `decisions/shared-files.md` antes de editar bases. Solo un spec modifica esas rutas a la vez; otros esperan integración o coordinan cambio base. Revisar lockfile/contratos por quien mantiene base, rebase y repetir controles, sin sobrescribir conflictos. Equipo acuerda nombres de revisoras.

Secuencia: decisiones/bootstrap → US1 → US2 → reversibilidad US4 → release/rollback US3 → completar US5. Capturar telemetría con CI desde inicio. No genera tasks ni asigna identidad/catálogo/pagos.

**Abiertas:** aprobación visual/material/acción; Cocineros-personal/Oferta-Promociones; metadato rama; cuentas/planes/región; ensayo FR-012 Vercel; retención/acceso individual; canal/umbrales; matriz exacta de versiones probada en bootstrap. Tienen puerta/evidencia arriba, ninguna validada.

**Archivos creados:** `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/platform.md` en esta carpeta. Sin modificar `spec.md`, código, tasks, rama, commits, push o PR. Hooks de plan: `.specify/extensions.yml` no existe al comprobar entrada y salida; no hay hooks que ejecutar.



### Raíz Git y raíz del workspace tras la reorganización

Las rutas de archivos de este plan son relativas a la raíz Git; pnpm/Turbo y comandos de aplicación se ejecutan dentro de proyecto/. No cambiar raíz Git, rama ni ubicación de agentes. Las rutas internas apps/*, packages/* y tests/* de configuraciones se interpretan desde proyecto/, por eso no llevan un segundo prefijo proyecto/. El cargador de entorno resuelve proyecto/.env, nunca reutiliza el archivo privado de la raíz.

scripts/env-check.ts es de aplicación y reside en proyecto/scripts/. Los futuros scripts que inspeccionan historial/reverts conservan scripts/ci/ en raíz Git y delegarán verificaciones con cwd proyecto/. Hooks Git futuros permanecen en .husky/ en raíz, delegando a la toolchain de proyecto/.

CI/Docker/despliegue aún no existen: .github/workflows/* permanecerá en raíz; los jobs de aplicación deberán usar working-directory proyecto, node-version-file proyecto/.node-version y cache-dependency-path proyecto/pnpm-lock.yaml. Sonar usará base proyecto (propiedades/LCOV relativos a ella), sin duplicar prefijos. Docker usará contexto proyecto, .dockerignore del workspace y Dockerfiles apps/api/Dockerfile y apps/worker/Dockerfile relativos al contexto (proyecto/apps/... desde raíz Git). Compose futuro será proyecto/infra/compose.yaml, invocado desde proyecto con -f infra/compose.yaml. Blueprint futuro proyecto/render.yaml, Vercel futuro proyecto/vercel.json; frontend proyecto/apps/web y paquetes compartidos dentro del monorepo proyecto. Configuración y capacidades de proveedores se verificarán en sus tareas, no aquí.
