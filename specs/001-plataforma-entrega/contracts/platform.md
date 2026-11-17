# Contratos mínimos — Plataforma de entrega

Propuesta para implementar y probar; no endpoints disponibles hoy. No hay API de negocio.

## API

- `GET /health`: readiness pública, `Cache-Control: no-store`. 200 JSON `{"status":"ok","version":"<sha>"}` si Postgres, Redis y RabbitMQ responden dentro de timeout acotado. 503 JSON `{"status":"unavailable","version":"<sha>"}` si falla alguna dependencia. El detalle técnico se registra sin secretos en logs; no exponer hosts/credenciales. Timeout propuesto de chequeo total: 3 s. Sin escrituras persistentes en cada sondeo.
- `GET /health/live`: 200 si proceso/event loop atiende, sin exigir servicios externos. Distingue fallo de proceso de falta de readiness; no convertir caída de Redis en reinicio infinito.
- Worker: señal técnica de actividad con versión y timestamp verificable desde red privada/herramienta técnica; sin servidor público nuevo. Integración valida publicación/consumo correlacionados en cola técnica aislada y limpia recursos.

## Web

- `GET /`: 200 HTML español, una sola página y contenido/foto aprobados. Acción candidata ancla informativa en misma ruta, sujeta al boceto. Sin controles de compra/menú que simulen capacidades inexistentes.
- `GET /api/health`: proxy técnico al `/health` de API configurada en runtime; preserva 200/503 y versión, sin cache. Solo se utiliza para comprobar conexión web→API, no se muestra como CTA del producto. URL upstream por allowlist de configuración, nunca parámetro del usuario.
- No almacenar secretos en JavaScript ni compilar URL de API distinta por entorno. Cambio de configuración debe preservar hash del paquete y ser probado antes de aceptar FR-012.

## Scripts del monorepo

La implementación expondrá `env:check`, `infra:check`, `dev`, `lint`, `format:check`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `test:smoke`, `build`, `load:staging` y `flags:set` desde la raíz del workspace proyecto/ vía pnpm. Salida 0 solo al pasar; fallos con causa y sin secretos. `dev` coordina web:3000/API:3001/worker; carga `.env` explícitamente. E2E local arranca/espera servicios web/API contra infraestructura local; integración usa Testcontainers separado. Smoke/carga cloud necesitan URL explícita y rechazan producción para carga. Flags:set solo acepta clave técnica permitida/booleano, con credenciales locales o identidad de pipeline autorizada; sin endpoint público de escritura.

## Contrato del candidato/pipeline

Manifiesto inmutable: candidateId, SHA, API/worker por digest, hash web, checksums migraciones, revisión configuración sin secretos, referencias de informes. Deploy y rollback consumen manifiestos, no tags mutables. Calidad ausente bloquea; Grafana caída reintenta durablemente. La aprobación production referencia ese candidato y no autoriza otro. Concurrencia serial por entorno, sin cancelar release activa.

Checks PR publican estado/cause/SHA y URL preview si disponible. Preview con staging compartido declara limitación y no atribuye éxito al backend del PR sin ensayo del candidato bajo exclusión mutua. Idempotencia de telemetría sigue `data-model.md`; ninguna métrica sintética se presenta como producción real.
