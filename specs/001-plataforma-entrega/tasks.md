# Tareas — Spec #1: Plataforma de entrega continua

**Entrada:** `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/platform.md`, `quickstart.md` y constitución v1.0.0. **Rama comprobada:** `feature/spec-1`. **Fecha:** 2026-11-16. Al generar la lista todas las tareas estaban pendientes; ver el registro de ejecución T001–T008 al final para su estado actual. Ningún despliegue validado.

La estructura adapta la plantilla: preparación, fundamentos, historias por prioridad y cierre. US4 precede a US3 dentro de P2 por dependencia de reversibilidad. No modificar spec/plan ni implementar otros specs. Esta lista no ejecuta ni autoriza automáticamente instalaciones, commits, push, PR o despliegues.

## Convenciones y primer hito

`CA USn.m` = escenario m de historia n; FR/SC conservan IDs del spec. `LOCAL` = trabajo sin cuentas/secretos cloud, con herramientas locales y descargas públicas iniciales. `PREP` = preparar archivos localmente; aceptación externa pendiente. `EXT A…` = requiere accesos de tabla final. `EQUIPO` = revisión/aprobación humana. Cada `dep.` es obligatoria; los IDs agrupan historias, el grafo define ejecución. `[P]` solo permite concurrencia tras dependencias y en archivos distintos. Un responsable serializa lockfile/manifiestos/contratos/configuración/tokens compartidos.

Tests obligatorios por constitución VI: casos antes de comportamiento, verificar fallo/éxito; unitarios, Testcontainers real y E2E de superficie existente. Evidencia en `specs/001-plataforma-entrega/evidence/`: SHA/candidato/fecha/SO/versiones/comando/esperado/real/informe/bloqueo, sin secretos ni PII innecesaria. Un YAML no demuestra requisito funcionando.

**H0 — Clon limpio local: T001–T022.** Instalación congelada, Compose, web inicial básica, API `/health`, worker, Postgres/Redis/RabbitMQ y Mailpit; pruebas y repetición independiente por compañera. Sin Vercel/Render/Sonar/Grafana ni diseño final. Web básica semántica con texto veraz de versión inicial, sin foto provisional ni CTA de negocio: soporte de arranque, no diseño final ni SC-009. **H1:** aprobación y pantalla final T035–T040. **H2:** US1+US2 y anotación T075 prueban SC-009. Spec completo incluye US3/4/5.

## Fase 1 — Preparación compartida (LOCAL)

- [X] T001 Verificar rama/ruta antes de editar y acordar responsable temporal/rutas base/ventana en `specs/001-plataforma-entrega/decisions/shared-files.md`; conservar diferencias CU003 del plan sin crear negocio (sin dependencias).
- [X] T002 Fijar y probar versiones exactas compatibles Node/pnpm/TypeScript/Next/Nest/herramientas en `proyecto/.node-version`, `proyecto/package.json`, `proyecto/pnpm-lock.yaml` y `specs/001-plataforma-entrega/decisions/runtime.md`; justificar dependencias y soporte común Vercel/Render, sin latest (dep. T001).
- [X] T003 Inicializar monorepo en `proyecto/pnpm-workspace.yaml`, `proyecto/turbo.json`, `proyecto/apps/web/package.json`, `proyecto/apps/api/package.json`, `proyecto/apps/worker/package.json`, `proyecto/packages/contracts/package.json`, `proyecto/packages/ui/package.json`, `proyecto/packages/config/package.json` y lockfile congelado (dep. T002).
- [X] T004 [P] Centralizar tipos estrictos/lint/fronteras/formato en `proyecto/packages/config/tsconfig.base.json`, `proyecto/packages/config/eslint.config.mjs` y `proyecto/.prettierrc.json` (dep. T003).
- [X] T005 [P] Crear `proyecto/.env.example` con todos los valores locales de quickstart y `.gitignore` para .env/secretos/temporales, sin tokens cloud ni valores reutilizables en producción (dep. T003).
- [X] T006 Implementar carga explícita/validación en `proyecto/apps/api/src/platform/config.ts`, `proyecto/apps/worker/src/config.ts`, `proyecto/apps/web/src/server/config.ts`, `proyecto/scripts/env-check.ts` y `proyecto/tests/unit/config.spec.ts`; ausentes fallan por nombre, nunca por volcado de valor (dep. T004, T005).
- [X] T007 Crear `proyecto/infra/compose.yaml`: Postgres/Redis/RabbitMQ/Mailpit por versión/digest, healthchecks/volúmenes/vhost local y puertos loopback; validar configuración (dep. T005).
- [X] T008 Crear esqueletos/exportaciones en `proyecto/apps/api/src/modules/{identidad,clientes,catalogo,promociones,carrito,pedidos,pagos,notificaciones,reportes}/index.ts` y propiedad de esquemas en `proyecto/apps/api/src/modules/README.md`, sin tablas/controladores de negocio (dep. T004, T006).

## Fase 2 — Fundamentos y aceptación H0 (LOCAL)

- [X] T009 [P] Escribir contrato de salud/liveness en `proyecto/tests/integration/health.int.spec.ts` y Jest en `proyecto/tests/integration/jest.config.ts`: 200/503/versión/no-store/timeout total 3s/sin secretos y liveness independiente; comprobar fallo inicial (dep. T008).
- [X] T010 [P] Escribir pruebas reales de conectividad/recuperación en `proyecto/tests/integration/infrastructure.int.spec.ts` con Testcontainers Postgres/Redis/RabbitMQ, puertos dinámicos/correlación/limpieza, sin cuentas cloud (dep. T008).
- [X] T011 Implementar Nest `/health` y `/health/live` en `proyecto/apps/api/src/main.ts`, `proyecto/apps/api/src/platform/health.controller.ts` y `proyecto/apps/api/src/platform/health.service.ts` según contrato; sin escrituras persistentes por sondeo ni reinicios infinitos por caída externa (dep. T009, T010).
- [X] T012 Implementar worker técnico con cierre limpio/versión/señal privada y publish-consume correlacionado en `proyecto/apps/worker/src/main.ts` y `proyecto/apps/worker/src/platform-probe.ts`, sin puerto público ni lógica pedidos/pagos (dep. T010, T011).
- [X] T013 Crear base funcional única ruta en `proyecto/apps/web/src/app/layout.tsx` y `proyecto/apps/web/src/app/page.tsx`: español/título/h1/landmarks/skip link/texto veraz; sin diseño final, foto provisional, formulario o CTA de flujo inexistente (dep. T011).
- [X] T014 Implementar proxy runtime en `proyecto/apps/web/src/app/api/health/route.ts` y `proyecto/apps/web/src/server/health-proxy.spec.ts`; preservar versión/200/503/no-store, upstream por allowlist, nunca URL del usuario ni secretos en cliente (dep. T013).
- [ ] T015 Implementar `proyecto/scripts/infra-check.ts` y scripts `proyecto/package.json`/`proyecto/turbo.json`: cargar .env, coordinar web:3000/API:3001/worker, SELECT técnico, Redis write/read/delete, Rabbit publish/consume y Mailpit; fallos devuelven no cero (dep. T007, T012, T014).
- [ ] T016 Configurar scripts lint/format:check/typecheck/test:unit/test:integration/test:e2e/test:smoke/build en `proyecto/package.json`, `proyecto/apps/web/vitest.config.ts` y `playwright.config.ts`; LCOV normalizado sin generados/duplicación y tests de comportamiento API/worker/componentes (dep. T015).
- [ ] T017 Ejecutar contratos/integración real hasta pasar degradación/recuperación/reinicio/persistencia técnica; guardar resultados en `specs/001-plataforma-entrega/evidence/local-infrastructure.md` (dep. T016).
- [ ] T018 Probar inicio básico→API, semántica/teclado/foco/axe en `proyecto/tests/e2e/bootstrap.spec.ts` y `proyecto/tests/smoke/bootstrap.spec.ts`; E2E arranca/espera apps, sin requerir diseño/material final (dep. T017).
- [ ] T019 Verificar instalación/build congelados e import prohibido en `proyecto/tests/unit/module-boundaries.spec.ts`; guardar versiones/lockfile intacto/reportes en `specs/001-plataforma-entrega/evidence/local-quality.md` (dep. T018).
- [ ] T020 Documentar arranque real/puertos/entorno/errores/segundo arranque/parada sin borrar volúmenes en `README.md` y `specs/001-plataforma-entrega/evidence/bootstrap-procedure.md`, sin cambiar spec/plan (dep. T019).
- [ ] T021 Registrar amenazas iniciales/ASVS L2 de superficie, inventario aún sin recolección, límites CU003 y Constitution Check documental en `specs/001-plataforma-entrega/decisions/platform-baseline.md`, sin certificar cloud ni implementar identidad (dep. T020).
- [ ] T022 Proponer a una compañera repetir T002–T020 desde clon/copia limpia del candidato sin .env/cache/instalación privada del autor y registrar aceptación/fallas H0 en `specs/001-plataforma-entrega/evidence/clean-clone.md`; no crear sprint ni asignar otro spec (dep. T021).

**Puerta H0:** arranque/pruebas locales reales reproducidos independientemente. No es aprobación visual ni SC-009. Si el candidato aún no está publicado, usar copia limpia sin archivos ignorados; no hacer push implícito para esta revisión.

## Fase 3 — US1: Integrar con controles automáticos (P1)

Objetivo: cada commit válido/verde, merge bloqueado al fallar. Prueba independiente: PR positivo frente a negativos con causa/SHA visibles. CA US1.1–5; FR-001–008; SC-001–003. Simular evaluador no sustituye rulesets/Sonar reales.

### Tests y preparación local

- [ ] T023 [P] [US1] Escribir fixtures/tests en `proyecto/tests/unit/commit-validation.spec.ts` y `proyecto/tests/integration/commit-history.int.spec.ts`: commit intermedio roto/mensaje inválido/cambio raíz/PR documental, repositorio temporal sin mutar rama actual (LOCAL; dep. T022; CA US1.1/2/5).
- [ ] T024 [P] [US1] Probar límites gate/seguridad en `proyecto/tests/unit/quality-gate.spec.ts`: cobertura insuficiente/Sonar ausente/hotspots pendientes y fixtures públicos de secretos/vulnerabilidad; conservar fallo intermitente original (LOCAL; dep. T022; CA US1.3/4).
- [ ] T025 [US1] Configurar `.husky/commit-msg`, `.husky/pre-commit`, `proyecto/commitlint.config.cjs`, `lint-staged.config.mjs`; comprobar tipo/alcance/descripción/feedback con fixtures, sin crear commits en rama actual (LOCAL; dep. T023; FR-001).
- [ ] T026 [US1] Implementar `scripts/ci/verify-commits.ts` y `scripts/ci/verify-commits.spec.ts`: base/historial completo desde raíz Git, checkout temporal por commit, lockfile propio y tipos/build/tests afectados con cwd proyecto/ y fallback total al cambiar raíz, sin omitir commits por cache (LOCAL; dep. T025; FR-002/SC-002).
- [ ] T027 [US1] Implementar `proyecto/scripts/ci/quality-gate.ts` y `proyecto/sonar-project.properties`; ResultadoCalidad con «cobertura nueva 0–100», «bugs/vulnerabilidades enteros ≥0», «hotspots revisados 0–100», «duplicación 0–100», «ausencia no significa aprobado»; ≥80%/≥95% módulos críticos, cero bugs/vulnerabilidades, hotspots 100%, duplicación <3%, ratings A (PREP; dep. T024; FR-007).
- [ ] T028 [US1] Redactar `.github/workflows/pr-quality.yml` y `.github/workflows/security.yml`: lint/tipos/tests reales/LCOV/build/Gitleaks/OSV/Trivy/CodeQL, permisos mínimos/SHA/causa; Sonar ausente y vulnerabilidad alta/crítica bloquean (PREP; dep. T026, T027; FR-006/008).

### Accesos y prueba externa

- [ ] T029 [US1] Confirmar A1 y documentar acceso efectivo Actions/GHCR/rulesets/environments en `specs/001-plataforma-entrega/evidence/github-access.md`, con protección propuesta en `specs/001-plataforma-entrega/decisions/github-controls.md`; no exigir checks inexistentes todavía (EXT A1; dep. T028).
- [ ] T030 [US1] Conectar Sonar/aplicar gate/check y complemento por módulo si hace falta; guardar referencias de credenciales/decoración/umbrales/negativa por caída en `specs/001-plataforma-entrega/evidence/sonar-gate.md` (EXT A1+A2; dep. T029; CA US1.3).
- [ ] T031 [US1] Ejecutar PRs de ensayo positivo/negativos y escaneos reales/aviso local/commit intermedio fallido; evidenciar CA US1.1–5 en `specs/001-plataforma-entrega/evidence/us1-controls.md`, sin integrar fixtures defectuosos (EXT A1+A2; dep. T030).
- [ ] T032 [US1] Medir controles propios US1 para PR ≤10 commits, optimizar cache sin perder comprobación por commit y registrar tiempo parcial/presupuesto restante en `specs/001-plataforma-entrega/evidence/ci-timing.md`; SC-001 completo espera T048 (EXT A1+A2; dep. T031).
- [ ] T033 [US1] Aplicar protección main en `Nicolay404/cafeteriaArquitecturaSW`: PR/≥1 aprobación/rebase/historial lineal/commits individuales/sin push directo o bypass ordinario/aprobación invalidada por cambio; probar rechazo en `specs/001-plataforma-entrega/evidence/main-protection.md` (EXT A1; dep. T031; FR-003).
- [ ] T034 [US1] Auditar controles propios/check agregado/documentación pura/fallo intermitente en `specs/001-plataforma-entrega/evidence/us1-acceptance.md`, sin éxito por check omitido; preview/E2E quedan pendientes hasta T047–048 (EXT A1+A2; dep. T032, T033).

## Fase 4 — US2: Preview y staging verificables (P1)

Objetivo: candidato visible antes del merge y staging automático después. Prueba independiente: URL web/API, E2E/axe bloqueantes, merge a staging con smoke; fallo mantiene N−1 y alerta. CA US2.1–4; FR-009–013/019; SC-004/009.

### Aprobación humana y diseño final, separados de H0

- [ ] T035 [US2] Recoger referencias elegidas por equipo y boceto humano móvil/escritorio en `specs/001-plataforma-entrega/decisions/visual-direction.md`; evaluar propuesta editorial café/crema y acción informativa real en misma página, sin generar imágenes/logos/mockups IA ni asumir datos de cafetería (EQUIPO; dep. T022).
- [ ] T036 [US2] Obtener fotos propias/licenciadas, licencias de fuentes y textos reales; registrar autor/fuente/licencia/atribución/alt en `specs/001-plataforma-entrega/decisions/assets.md` y aprobación explícita de las tres personas de boceto/composición/tipos/colores/foto/textos en `specs/001-plataforma-entrega/decisions/visual-approval.md`; material faltante bloquea diseño final (EQUIPO A7; dep. T035).
- [ ] T037 [US2] Escribir pruebas de componentes/página aprobados en `proyecto/packages/ui/src/base.spec.tsx` y `proyecto/tests/e2e/home.spec.ts`, foto válida/acción real/teclado/foco/reduce-motion, sin catálogo/login/compra (LOCAL; dep. T036).
- [ ] T038 [US2] Implementar solo pantalla/tokens/componentes usados aprobados en `proyecto/packages/ui/src/tokens.css`, `proyecto/packages/ui/src/index.ts`, `proyecto/apps/web/src/app/page.tsx`, `proyecto/apps/web/src/app/globals.css` y `proyecto/apps/web/public/images/`; español breve/una acción/sin datos inventados ni stock presentado como establecimiento real (LOCAL; dep. T037).
- [ ] T039 [US2] Ejecutar Playwright/axe de inicio y conexión API, medir contraste texto normal/hover/foco/error ≥7:1, objetivos ≥44×44px y movimiento reducido sin ocultar contenido; guardar `specs/001-plataforma-entrega/evidence/home-automated.md` (LOCAL; dep. T038).
- [ ] T040 [US2] Proponer a otra compañera revisión cruzada en `specs/001-plataforma-entrega/evidence/home-review.md`: boceto vs página, Tab/Shift+Tab/Enter/skip link/foco visible, NVDA o VoiceOver, reflow/texto ampliado/capturas 320/390/768/1024/1440; usar `.claude/skills/design-taste-frontend/SKILL.md` solo para jerarquía/composición/consistencia, sin instalar/generar diseño ni certificar AAA con axe solo (EQUIPO; dep. T039; sin sprint individual).

### Candidato, configuración y despliegue

- [ ] T041 [US2] Probar contratos en `proyecto/tests/unit/candidate.spec.ts` y `proyecto/tests/integration/deployment-config.int.spec.ts`; implementar `proyecto/packages/contracts/src/candidate.ts` y `proyecto/packages/contracts/src/environment.ts`: Candidato «Inmutable», SHA/digests/hash/checksums/configRevision/reportRefs «sin secretos dentro»; Entorno «tipo preview/staging/production, PR si preview», «Configuración no contiene valores secretos»; demostrar dos configuraciones runtime locales sin cambiar hash (LOCAL; dep. T022).
- [ ] T042 [US2] Crear `proyecto/apps/api/Dockerfile`, `proyecto/apps/worker/Dockerfile`, `proyecto/scripts/ci/package-candidate.ts` y `proyecto/vercel.json`: paquete reproducible por candidato, API-worker por digest/web prebuilt/manifiesto, sin URL compilada por entorno; cambio SHA/rebase/build main exige candidato nuevo nuevamente controlado (PREP; dep. T041, T028).
- [ ] T043 [US2] Redactar `proyecto/render.yaml` con API/worker/Postgres/réplica/Key Value/RabbitMQ privado persistente, healthchecks/región común/autodeploy desactivado con sintaxis soportada; `proyecto/scripts/deploy/preview.ts` y `.github/workflows/preview.yml` con limpieza PR/datos sintéticos aislados/secretos por referencia (PREP; dep. T042; prueba requiere A3+A4).
- [ ] T044 [US2] Confirmar A3/A4 y probar mismo paquete/hash prebuilt con API runtime correcta/secretos separados/red privada/región común/permisos solo pipeline/autodeploy apagado; guardar `specs/001-plataforma-entrega/evidence/artifact-promotion.md`; si Vercel exige rebuild/modificar paquete, bloquear FR-012 y registrar decisión sin alterar spec/plan (EXT A1+A3+A4; dep. T043).
- [ ] T045 [US2] Ejecutar preview PR con URLs/SHA/manifiesto en `specs/001-plataforma-entrega/evidence/preview.md`; fallback staging exige exclusión mutua/datos aislados/restauración en `proyecto/scripts/deploy/preview.ts` y limitación rotulada: no prueba backend PR sin ensayo del candidato; bloquear si no garantizable (EXT A1+A3+A4; dep. T044, T034, T040; CA US2.1).
- [ ] T046 [US2] Implementar `.github/workflows/staging.yml`, `proyecto/scripts/deploy/staging.ts` y `proyecto/tests/smoke/staging.spec.ts`: candidato main nuevamente controlado, migración técnica previa compatible, API/worker antes de web/smoke por manifiesto, conservar N−1 y alertar fallo A6 (PREP/EXT A1+A3+A4+A6; dep. T045; CA US2.3/4).
- [ ] T047 [US2] Integrar E2E/axe preview y check agregado fail-closed en `.github/workflows/preview.yml` y ruleset; fallo flujo/axe bloquea merge y PR no dispara main; evidenciar en `specs/001-plataforma-entrega/evidence/preview-gating.md` (EXT A1+A3+A4; dep. T046; CA US2.2, FR-008/009).
- [ ] T048 [US2] Ejecutar CA US2.1–4 y US1 con checks completos; medir PR ≤10 commits <15min/merge→staging <20min, fallo conserva N−1/alerta; guardar `specs/001-plataforma-entrega/evidence/us2-acceptance.md` (EXT A1+A2+A3+A4+A6; dep. T047; SC-001/004; SC-009 espera T075).
- [ ] T049 [US2] Implementar k6 de rutas existentes/guardia que rechaza producción en `proyecto/tests/load/platform.js` y `.github/workflows/load.yml`; programar nocturna y pre-festividades/probar cron staging, guardar `specs/001-plataforma-entrega/evidence/load-schedule.md`, menú/pedidos no evaluables (PREP/EXT A1+A4; dep. T048; FR-018).

## Fase 5 — US4: Reversión segura (P2, prerrequisito de US3)

Objetivo: revertir sin romper datos/aplicación y desactivar incompletos sin redeploy. Prueba independiente: commit main al azar incluido caso migración, revert en copia desechable pasa CI/staging; flag apagado oculta/deniega capacidad técnica. CA US4.1–3; FR-005; SC-007.

- [ ] T050 [P] [US4] Escribir pruebas Redis/reinicio/caída/escritura no autorizada en `proyecto/tests/integration/flags.int.spec.ts`; FlagTécnico «clave permitida, booleano, revision, changedAt» y «lectura runtime y false seguro ante fallo», sin panel público/negocio (LOCAL; dep. T022).
- [ ] T051 [P] [US4] Escribir ensayo expand/contract/checksum/lock/N-N−1/fallo antes de activar/compensación conservando filas en `proyecto/tests/integration/migrations.int.spec.ts`, solo tabla técnica sintética (LOCAL; dep. T022).
- [ ] T052 [US4] Implementar flags runtime/CLI restringida en `proyecto/apps/api/src/platform/flags.service.ts`, `proyecto/scripts/flags-set.ts` y `proyecto/package.json`; local o identidad pipeline autorizada, no endpoint público, persistencia Redis/sin redeploy/falla seguro (LOCAL; dep. T050; CA US4.3).
- [ ] T053 [US4] Implementar runner/fixture en `proyecto/scripts/db/migrate.ts` e `proyecto/infra/migrations/001_platform_probe.sql`, expansión/compensación en `proyecto/tests/fixtures/migrations/`; no borrar/revertir migración aplicada ni crear tablas de negocio (LOCAL; dep. T051).
- [ ] T054 [US4] Documentar rollback primero/revert por PR después, compensación/compatibilidad/flags en `specs/001-plataforma-entrega/decisions/reversibility.md`; preparar `scripts/ci/verify-revert.ts` desde raíz Git y delegar chequeos con cwd proyecto/ usando copia desechable, sin cambiar rama actual (LOCAL; dep. T052, T053; CA US4.1/2).
- [ ] T055 [US4] Integrar runner/flags en `.github/workflows/staging.yml` y `proyecto/render.yaml`; probar cambio flag sin deploy/fallo migración conserva N−1 en `specs/001-plataforma-entrega/evidence/reversibility-staging.md` (EXT A1+A4; dep. T054, T048; serializar edición con T046).
- [ ] T056 [US4] Seleccionar commits main al azar incluido fixture migratorio y probar revert temporal/CI/staging; guardar muestra/SHA/antes-después y resultado 100% pruebas realizadas en `specs/001-plataforma-entrega/evidence/us4-acceptance.md`, sin afirmar prueba exhaustiva (EXT A1+A2+A3+A4; dep. T055; CA US4.1–3/SC-007).

## Fase 6 — US3: Producción aprobada y rollback (P2)

Objetivo: publicar candidato staging aprobado sin interrupción y restaurar automáticamente ante fallo. Prueba independiente: release buena, sin aprobación, dos releases próximas, migración fallida y smoke fallido en ensayo autorizado. CA US3.1–5; FR-004/014–017; SC-005/006.

- [ ] T057 [P] [US3] Probar orquestador con adaptadores simulados en `proyecto/tests/unit/release-orchestrator.spec.ts`: aprobación ligada a candidato/orden backend-web/serialización/fallo migración/rollback; mocks no son aceptación cloud (LOCAL; dep. T054).
- [ ] T058 [P] [US3] Crear esquema y tests en `proyecto/packages/contracts/src/deployment.ts` y `proyecto/tests/unit/deployment.spec.ts`: Despliegue «approverId solo producción», «vínculo al despliegue restaurado», «Producción no admite dos despliegues simultáneos», «Nunca marcar correcto antes de smoke», estados de data-model y manifiesto anterior (LOCAL; dep. T041, T054).
- [ ] T059 [US3] Configurar release-please/SemVer/changelog en `release-please-config.json`, `.release-please-manifest.json` y `.github/workflows/release-please.yml`; probar desde Conventional Commits y preservar commits individuales, sin publicar tags desde máquina personal (PREP; dep. T057, T058; CA US3.5).
- [ ] T060 [US3] Confirmar A1/A3/A4/A6, Environment production/revisores/permisos/secretos y capacidad para rollback/disponibilidad; evidenciar restricciones efectivas en `specs/001-plataforma-entrega/evidence/production-access.md` (EXT; dep. T059, T056, T048).
- [ ] T061 [US3] Implementar `proyecto/scripts/deploy/release.ts` y `.github/workflows/production.yml`: manifiesto probado staging sin rebuild, aprobación de ese candidato, serializar sin cancelar activa, migrar antes de backend/API-worker antes de web y smoke por versión (PREP; dep. T060, T057, T058).
- [ ] T062 [US3] Implementar `proyecto/scripts/deploy/rollback.ts` y `proyecto/tests/smoke/production.spec.ts`: restaurar web/API/worker por identidad previa/repetir smoke/alertar, sin datos destructivos; conservar artefactos, no tags mutables ni solo retención proveedor (PREP; dep. T061).
- [ ] T063 [US3] Ensayar sin aprobación y dos candidatas aprobadas próximas; demostrar no deploy/no concurrencia/orden en `specs/001-plataforma-entrega/evidence/production-approval.md` (EXT A1+A3+A4; dep. T062; CA US3.2/caso límite).
- [ ] T064 [US3] Ensayar migración fallida y release buena con sintéticos/sondeo continuo/N-N−1; backend anterior conservado/tag/changelog en `specs/001-plataforma-entrega/evidence/production-release.md` (EXT A1+A3+A4; dep. T063; CA US3.1/4/5, SC-006).
- [ ] T065 [US3] Provocar smoke fallido autorizado, medir detección→restauración <5min y verificar componentes previos/datos/recepción alerta en `specs/001-plataforma-entrega/evidence/production-rollback.md`; si capacidad/plan impide meta, no cerrar (EXT A1+A3+A4+A6; dep. T064; CA US3.3/SC-005).
- [ ] T066 [US3] Consolidar CA US3.1–5 y guion PR de revert posterior a rollback en `specs/001-plataforma-entrega/evidence/us3-acceptance.md`; sin commits/push automáticos ni certificar disponibilidad con readiness solo (EXT; dep. T065).

## Fase 7 — US5: Entrega y aporte del equipo (P3)

Objetivo: cinco paneles fiables/privados, alertas de equipo y recuperación sin perder eventos. Prueba independiente: despliegue aparece <1h, revisión con pocos commits igual de visible, cuenta sin permiso denegada, alertas y recuperación tras caída. CA US5.1–4; FR-020–024; SC-008/009.

Preparación con datos sintéticos desde H0/US1, sin esperar producción. Sin actividad personal real antes de T067. Grafana caída no bloquea CI. DORA productiva queda sin datos hasta releases, ensayos sintéticos rotulados; staging nunca es producción.

- [ ] T067 [US5] Aprobar inventario/finalidad de IDs/actividad, roles y retención propuesta detalle 90 días/agregados 12 meses en `specs/001-plataforma-entrega/decisions/metrics-privacy.md`; informar a las tres personas y documentar derechos/acceso/rectificación/eliminación antes de extraer datos reales (EQUIPO A8; dep. T021; FR-023).
- [ ] T068 [P] [US5] Escribir contratos/tests sintéticos en `proyecto/packages/contracts/src/telemetry.ts` y `proyecto/tests/unit/telemetry-contracts.spec.ts`: «Fechas UTC; duraciones enteras no negativas»; PropuestaCambio «repo permitido, número positivo», «previewURL HTTPS opcional»; Commit «SHA completo»; Ejecución «attempt positivo»; EventoEntrega «Clave única source+externalId+attempt+tipo; persistir antes de envío»; CursorFuente «Avanza tras persistir lote; solapamiento deduplicado»; MétricaEquipo «subjectId solo donde autorizado», «no inventar cero cuando faltan muestras» (LOCAL sintético; dep. T022).
- [ ] T069 [P] [US5] Probar durabilidad/deduplicación/reinicio/retry/Grafana caída en `proyecto/tests/integration/telemetry.int.spec.ts`, DORA/ventanas sin muestras/acceso individual en `proyecto/tests/unit/team-metrics.spec.ts`, sin PII real (LOCAL; dep. T022).
- [ ] T070 [US5] Implementar eventos/cursores en `proyecto/infra/migrations/002_delivery_telemetry.sql` y `proyecto/apps/worker/src/telemetry/repository.ts`, con restricciones T068/persistencia previa a envío/separación negocio, sin abrir Postgres a Actions (LOCAL; dep. T068, T069, T053).
- [ ] T071 [US5] Implementar fuentes GitHub/Actions/Sonar con cursor/solapamiento en `proyecto/apps/worker/src/telemetry/sources.ts` y fixtures en `proyecto/apps/worker/src/telemetry/sources.spec.ts`; PR/revisiones/tests/docs/fallos originales/deploy por manifiesto, sin emails/comentarios innecesarios (PREP; dep. T070; reales requieren T067+A1+A2).
- [ ] T072 [US5] Implementar exportador durable/retry/confirmación/correlación OpenTelemetry en `proyecto/apps/worker/src/telemetry/exporter.ts`, `.github/workflows/metrics.yml` e `proyecto/infra/observability/collector.yaml`; Mimir baja cardinalidad/Loki sin secretos/PII, cron privado recupera ejecuciones omitidas y CI sigue ante caída Grafana (PREP; dep. T071).
- [ ] T073 [US5] Confirmar A5/configurar fuentes/grupos/tokens mínimos, restringiendo fuente/consultas y panel individual; referencias en `proyecto/infra/observability/datasources.yaml` y prueba en `specs/001-plataforma-entrega/evidence/grafana-access.md` (EXT A1+A2+A5+A8; dep. T067, T072).
- [ ] T074 [US5] Implementar cinco paneles en `proyecto/infra/observability/dashboards/{dora,flow,quality,pipeline,contribution}.json`: definiciones plan/staging separado/igual peso revisiones-commits-tests-docs/sin ranking/muestras insuficientes explícitas (PREP/EXT A5; dep. T073).
- [ ] T075 [US5] Correlacionar candidato mínimo T048 con GitHub/pipeline/gate y anotación staging Grafana; medir evento→panel <1h y registrar `specs/001-plataforma-entrega/evidence/sc009-delivery.md`, sin fabricar producción/tasas DORA (EXT A1+A2+A3+A4+A5; dep. T074, T048; SC-008/009).
- [ ] T076 [US5] Configurar alertas main rojo/gate/fallos de cambios en `proyecto/infra/observability/alerts.yaml`, revisar umbrales del plan y probar notificación al canal autorizado en `specs/001-plataforma-entrega/evidence/metrics-alerts.md` (EXT A5+A6; dep. T075; CA US5.4).
- [ ] T077 [US5] Probar autorizado vs cuenta sin permiso sobre panel individual/consultas/fuentes, retención/derechos y corregir fugas antes de uso normal; evidencia minimizada en `specs/001-plataforma-entrega/evidence/metrics-privacy.md` (EXT A5+A8; dep. T074; CA US5.3).
- [ ] T078 [US5] Interrumpir Grafana/exportador y reiniciar worker; comprobar cursor/recuperación sin pérdida o duplicación/continuidad CI en `specs/001-plataforma-entrega/evidence/metrics-recovery.md` (EXT A1+A4+A5; dep. T075; caso límite).
- [ ] T079 [US5] Verificar deploy productivo T064/T065 con anotación/timestamps y revisión de persona con pocos commits; datos <1h/igual visibilidad en `specs/001-plataforma-entrega/evidence/metrics-production.md`; rotular ensayos sintéticos sin confundir con clientes reales (EXT A1+A4+A5+A8; dep. T066, T077, T078; CA US5.1/2).
- [ ] T080 [US5] Consolidar CA US5.1–4/cinco paneles/SC-008/009 en `specs/001-plataforma-entrega/evidence/us5-acceptance.md`; pendientes explícitos si falta producción/cuenta/privacidad, nunca éxito por dashboard vacío (EXT; dep. T076, T079).

## Fase 8 — Cierre transversal y traspaso

- [ ] T081 Auditar FR-001–024/SC-001–009/Constitución I–VII en `specs/001-plataforma-entrega/evidence/acceptance-matrix.md`: probado/fallido/bloqueado/no evaluable con enlaces, sin cerrar por YAML o rebajar umbrales (dep. T034, T048, T049, T056, T066, T080).
- [ ] T082 Repetir clon limpio tras flags/despliegue/telemetría/diseño, exportación cloud desactivada localmente, con compañera de arranque y `specs/001-plataforma-entrega/evidence/clean-clone-final.md` (dep. T081).
- [ ] T083 Repetir revisión cruzada UI/AAA con otra compañera sobre candidato release/resolver desviaciones del boceto en `specs/001-plataforma-entrega/evidence/home-review-final.md`; Taste no prevalece sobre autoría/constitución (dep. T082).
- [ ] T084 Entregar índice ADR/aprobaciones/evidencia/contratos/scripts/dueños/bloqueos en `specs/001-plataforma-entrega/evidence/README.md` y `specs/001-plataforma-entrega/decisions/handoff.md`, contexto Markdown sin asignar otros specs ni commits/push automáticos (dep. T083).

## Bloqueos externos y puertas de aprobación

**Sin comprobar al generar tareas.** Falta confirmación/evidencia, no se afirma que las cuentas no existan. No guardar tokens en Markdown. PREP no satisface EXT.

| Puerta | Acceso/decisión pendiente | Tareas | Prueba posterior |
|---|---|---|---|
| A1 GitHub | Admin repo destino/Actions/rulesets/GHCR/environments/revisores/tokens mínimos | T029–034, T044–049, T055–066, fuentes métricas | Push directo/merge roto rechazados, checks visibles, imagen accesible, sin aprobación no deploy |
| A2 Calidad | Sonar proyecto/análisis PR/admin gate/tokens lectura-análisis | T030–034/048/056/071–080 | PR decorado, umbrales/negativas/caída bloquean, fuentes accesibles |
| A3 Frontend | Vercel proyecto/plan staging/token CI/permisos solo pipeline | T044–048/056/060–066/075 | Autodeploy apagado, hash constante/API-secreto correctos, preview/staging/rollback reales |
| A4 Backend | Render workspace/plan previews-predeploy/capacidad, GHCR lectura, región/red privada/persistencia/backups/réplica | T044–049/055–066/073–080 | Digest real, datos privados, migración fallida conserva N−1, rollback <5min/sondeo sin caída |
| A5 Métricas | Grafana/Mimir/Loki/fuentes/grupos/tokens mínimos | T073–080 | Cinco paneles/evento <1h/denegación consulta-panel/recuperación sin pérdida |
| A6 Alertas | Canal autorizado/responsable/credenciales | T046/048/060/065/076 | Recepción con timestamp main/staging/rollback y umbrales acordados |
| A7 Diseño | Boceto humano/textos/foto/fuentes/licencias/aprobación | T036–040/UI final | Acta previa a diseño final, licencias y revisión visual/AAA; no bloquea H0 técnico |
| A8 Datos equipo | Finalidad/retención/grupo acceso/información previa | T067/073–080 | Inventario aprobado, denegación/retención/derechos antes de recolección real |

FR-012 tiene puerta técnica T044: contratar servicio no demuestra promoción inmutable. Rebuild requerido implica bloqueo/decisión del equipo, sin alterar plan/spec aquí. Si preview backend no está disponible, T045 debe demostrar aislamiento/exclusión/restauración y limitación, o US2 bloqueada. Capacidad económica/operativa SC-005/006 se confirma T060/T065.

## Dependencias y orden de ejecución

```text
T001–008 → T009–022 → H0 local
H0 → US1 T023–034 (EXT A1/A2)
H0 → T035–040 (equipo → diseño final → revisión)
H0 → T041–044 (candidato → ensayo externo)
US1 + UI aprobada + T044 → T045–048 → US2 preview/staging
US2 → T049 carga programada
H0 → T050–054 flags/migraciones locales
T054 + US2 → T055–056 → US4
US4 + US2 + T057–060 → T061–066 → US3
H0 → T068–072 telemetría sintética (T070 espera T053)
T067 + T072 + accesos → T073–078 (T075 espera T048)
US3 + T077/T078 → T079–080 → US5 completa
US1/2/4/3/5 + carga → T081–084 → cierre
```

Los IDs agrupan historias, no exigen esperar todas las anteriores si dependencias satisfechas. Preparar pruebas/archivos locales puede adelantarse al cierre cloud; un ID posterior puede ser prerrequisito común. US1 controla sus jobs; elegibilidad global merge requiere T047/048: T034 no espera preview, no hay ciclo US1↔US2. T046 usa migración técnica de ensayo; runner/flags de reversibilidad se integran T055 antes de producción. No cambiar rama automáticamente.

### Paralelismo sin colisiones

- Preparación: T004/T005 tras T003; T009/T010 tras T008. Un responsable serializa lockfile/manifiestos.
- US1: T023/T024 tras H0 en pruebas distintas, convergen en pipeline después.
- US2: referencias/boceto T035–036 junto con contratos/paquete T041–042; T040/T044 tienen rutas distintas cuando sus dependencias estén listas. Pantalla final nunca antes de T036.
- US4: T050/T051 tras H0; `proyecto/package.json`/`proyecto/render.yaml` se editan serialmente con responsable de US2.
- US3: T057/T058 tras T054 (T058 también T041), tests orquestador frente a contrato, sin workflows simultáneos.
- US5: T068/T069 tras H0 solo sintéticos; reales esperan T067. Paneles separables por JSON tras datasource/permisos comunes, con una revisión de acceso.

Son oportunidades para tres personas, no asignaciones de historias/specs ni sprints individuales. Las dos revisiones cruzadas comprueban el mismo incremento; equipo acuerda y registra nombres.

## Trazabilidad de aceptación

| Historia / escenarios | Tareas | Requisitos/criterios |
|---|---|---|
| US1.1/2/5 | T023/025/026/028/031–034/047–048 | FR-001/002/003/006/008; SC-001/002/003 |
| US1.3/4 | T024/027/028/030/031 | FR-006/007/008; negativas calidad/seguridad |
| US2.1/2 | T035–045/047–048 | FR-009/010/011/012/019; aprobación y preview bloqueante |
| US2.3/4 | T046/048 | FR-013; SC-004; N−1/alerta |
| US3.1/2/5 | T057–064/066 | FR-004/014/015/016/019; SC-006 |
| US3.3/4 | T051/053/062/064/065 | FR-015/017; SC-005/006 |
| US4.1/2/3 | T050–056 | FR-005; SC-007 |
| US5.1/2/3/4 | T067–080 | FR-020/021/022/023/024; SC-008 |
| Carga | T049 | FR-018; no atribuir capacidad de pedidos inexistentes |
| Incremento mínimo completo | T022/040/048/075 | SC-009 solo tras PR→staging y anotación entrega |
| Entornos/secretos/inmutabilidad | T041–046/060–065 | FR-010/011/012/019 efectivos, no solo YAML |

## Estrategia incremental

1. **Primer bloque sin accesos externos:** T001–T022. Versiones/lockfile/entorno/Compose/web básica/API/worker/tests y revisión limpia. Herramientas/descargas públicas son prerrequisitos, no cuentas cloud. T050–054/T068–072 también preparables localmente según dependencias y con datos sintéticos.
2. **Entrega técnica:** US1 controla commits/calidad; A1/A2 necesarios para aceptación externa. No llamarlo pipeline completo sin preview/E2E.
3. **Entrega visible:** aprobación humana→UI final→US2; T075 completa SC-009. No simular material/diseño aprobado para acelerar H0.
4. **Entrega reversible:** US4 antes de producción US3, ensayos autorizados sin clientes reales ni deploy desde máquina personal.
5. **Visibilidad responsable:** capturar telemetría desde inicio con fuentes/privacidad autorizadas, completar cinco paneles/negativas; Grafana no bloquea deploy y dashboard vacío no es éxito.
6. Cierre exige pruebas/revisión/enlaces, sin rebajar requisitos. Cuenta/permiso/secreto/material/decisión faltante conserva estado bloqueado y ensayo posterior.

**Conteo:** 84 tareas: preparación 8, fundamentos 14, US1 12, US2 15, US4 7, US3 10, US5 14, cierre 4. Doce tareas `[P]` con dependencias explícitas. Todas las de historia tienen `[USn]`; preparación/fundamentos/cierre no. Estado actual de T001–T008 en el registro inferior; todas las posteriores siguen pendientes. Commits futuros solo atómicos/verdes y con autorización; esta generación no ejecuta acciones externas.


## Ejecución acotada T001–T008 — 2026-11-16

Completadas y verificadas: T001, T002, T003, T004, T005, T006 y T008. T007 pendiente: docker no está en PATH ni existe el ejecutable en la ubicación habitual de Docker Desktop; sin Compose no se pueden validar configuración, imágenes/digests o healthchecks. No se creó un compose.yaml sin comprobar ni se instaló Docker. Reanudar T007 cuando Docker/Compose estén disponibles, fijar imágenes/digests reales y ejecutar `docker compose --env-file .env.example -f infra/compose.yaml config` antes de marcarla.

T008 se ejecutó tras sus dependencias T004/T006, sin depender de T007. No se avanzó T009 ni se implementó salud, runtime worker, página web, diseño final o cloud. Evidencia/comandos/listado de archivos en [evidence/t001-t008.md](evidence/t001-t008.md). Las verificaciones del bootstrap no certifican H0 completo, Sonar, CI/CD ni accesibilidad de una interfaz aún no construida.

## Reorganización autorizada del workspace

Raíz Git/agentes/documentación sin mover; monorepo bajo proyecto/. Las rutas de tareas son relativas a Git, salvo comandos que se ejecutan con cwd proyecto/. Se conservaron IDs, dependencias y estados: T001–T006/T008 completadas, T007 pendiente, sin avanzar T009. El traslado no vuelve a ejecutar ni completa nuevas tareas. Evidencia: [evidence/workspace-reorganization.md](evidence/workspace-reorganization.md).

Los workflows futuros quedan en .github/workflows/ (raíz), con working-directory proyecto para aplicación, node-version-file proyecto/.node-version y cache-dependency-path proyecto/pnpm-lock.yaml. Hooks .husky y scripts de historial/revert son de repositorio: permanecen en raíz y delegan a proyecto; commitlint de aplicación se resolverá desde proyecto y lint-staged respetará rutas Git. release-please de raíz deberá apuntar al paquete/versionado dentro de proyecto. Sonar base proyecto; Docker contexto proyecto; Compose futuro proyecto/infra/compose.yaml, Blueprint proyecto/render.yaml y frontend proyecto/apps/web. No se implementó ninguno de esos servicios en esta reorganización.

## Continuación T007 — 2026-11-17

Rama autorizada `feature/spec-1-continuacion`, creada desde `origin/main` c5f705772b3f06f502147fb5f8e6b0377190eb5a después de fetch y árbol limpio. `origin/main` y `origin/feature/spec-1` tienen árboles idénticos; la rama anterior permanece intacta. Esta entrada actualiza el estado histórico anterior: Docker/Compose ahora están instalados y el motor Linux se pudo iniciar con Docker Desktop existente, sin instalar herramientas.

T007 completada: cuatro imágenes fijadas por versión/digest de registro, volúmenes persistentes, vhost local, healthchecks y puertos loopback. Configuración, arranque sano, SELECT 1, PING, vhost, readyz y segundo arranque verificados. En este Windows 5432 está ocupado: prueba con POSTGRES_PORT=55432, sin detener proceso ajeno. Parada final sin eliminar volúmenes. Evidencia detallada y comandos: [evidence/t007-local-compose.md](evidence/t007-local-compose.md).

T009 y T010 siguen pendientes: Jest y Testcontainers no están declarados ni disponibles en el workspace; se comprobó resolución sin instalarlos. La instrucción vigente prohíbe instalar herramientas. Para desbloquear, el equipo debe autorizar/incorporar estas dependencias de desarrollo con versiones exactas y lockfile, y comprobar el fallo inicial del contrato y la integración real. Vitest de configuración no sustituye estas pruebas. T011 y posteriores conservan sus dependencias; no se salta a implementar API/web/worker ni otros specs. Cloud y aprobación visual humana siguen pendientes según la tabla de accesos.

## Bloque T009–T010 — 2026-11-17

Rama comprobada `feature/spec-1-continuacion`; origin fetch/push sigue en el fork Nicolay404/cafeteriaArquitecturaSW. Árbol inicialmente limpio en 001c399. Autorización nueva: dependencias de desarrollo necesarias con pnpm, sin instalaciones globales. No se repitió T007 ni se modificó Compose.

T010 completada: seis pruebas reales Testcontainers pasan con Postgres, Redis y RabbitMQ; SQL parametrizado, Redis write/read/delete comprobado, publicación confirmada/consumo/ack correlacionados y cola exclusiva, caída por pausa, recuperación y reinicio de cada servicio. Puertos asignados por Docker, URLs recalculadas tras reinicio, sin tocar el listener 5432, volúmenes Compose o datos de negocio. Limpieza en finally/afterAll y rollback de arranque parcial.

T009 escrita y ejecutada, pero pendiente por instrucción de no marcar pruebas fallidas: seis casos fallan explícitamente porque aún no existe apps/api/src/main.ts (T011). Contiene 200/503/versión/no-store/3s total/cuerpo y cabeceras sin secretos/liveness independiente, dependencias congeladas y recuperación. No se creó API simulada, no se omitieron casos ni se usó test.failing. La suite general devuelve salida 1. La configuración Jest y tipos/lint/formato sí pasan.

No se hizo commit ni push: la autorización de publicación está condicionada a que pase el bloque, y T009 queda en rojo. PR #2 no se modificó. Se detiene antes de T011. Para desbloquear la aceptación verde hace falta autorizar T011 en otro bloque; esta anotación de T009 pendiente no modifica las dependencias ni amplía la autorización actual. Evidencia, versiones y comandos en [evidence/t009-t010.md](evidence/t009-t010.md).

## API verificada T009–T011 — 2026-11-17

La autorización actual amplía a implementación/publicación por bloques y merge solo tras todos los requisitos. Se conservaron los cambios locales de T009/T010. T009 y T011 completadas: contrato HTTP 200/503, versión, no-store, timeout total <=3s, sin secretos y liveness independiente pasan contra Nest real y tres Testcontainers. Suite completa 12/12; tipos/lint/formato/11 tests de configuración/instalación congelada pasan. No se repitió T007. Evidencia [evidence/t011-health.md](evidence/t011-health.md). Los registros anteriores de contrato rojo se conservan como historia y quedan superados por esta ejecución verde; no certifica H0 completo, Sonar o despliegues.

## T012 verificada — 2026-11-17

Confirmada rama feature/spec-1-continuacion/PR #2. Se conserva la versión con instanceId:string. Señal Redis privada (versión/timestamp/TTL), publish/consume/ack correlacionados, cierre del coordinador y arranque/cierre del proceso Nest sin HTTP probados. Suite completa 15/15, tipos/lint/formato/config 11/11 e instalación congelada pasan sobre la versión final. Evidencia histórica y resolución: [evidence/t012-worker-pending.md](evidence/t012-worker-pending.md). No certifica todavía H0, UI o cloud; no autoriza merge.

## T013–T014 verificadas — 2026-11-17

Inicio básico español/título/h1/landmark/skip link, texto veraz sin catálogo/formulario/foto provisional; estilos mínimos de accesibilidad, sin diseño final. Proxy runtime solo hacia el origin configurado, sin redirecciones ni URL del cliente, preserva 200/503/versión/no-store y filtra campos extras. Fallo de red devuelve 503/version unknown. Nueve tests web y cuatro HTTP contra Next compilado pasan; suite completa 19/19; tipos/lint/formato y configuración 11/11 pasan. Build de producción real pasó. Evidencia [evidence/t013-t014-web.md](evidence/t013-t014-web.md). T015 sigue pendiente; no se certifican arranque coordinado, UI final, E2E o cloud.
