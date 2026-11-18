# Quickstart: Administración, reportes y auditoría (Spec #8)

Este documento describe cómo inicializar, ejecutar y probar los escenarios de analítica, auditoría y administración del Spec #8.

## Requisitos previos
- Node.js >= 24 y pnpm configurados.
- Base de datos Postgres con migraciones ejecutadas (`infra/migrations/002_reports_schema.sql`).

---

## Escenario 1: Consultar reporte de ventas y ticket medio
```bash
curl -X GET "http://localhost:3000/api/admin/reports/sales?from=2026-11-01&to=2026-11-07" \
  -H "Authorization: Bearer <TOKEN_ADMIN>"
```
**Resultado esperado**:
- Total de ventas y ticket medio calculados en centavos enteros (`amount_cents`).
- Desglose por día y porcentaje por método de pago (`card`, `cash`, `transfer`).

---

## Escenario 2: Exportar reporte a CSV seguro
```bash
curl -X GET "http://localhost:3000/api/admin/reports/export?type=sales&from=2026-11-01&to=2026-11-07&format=csv" \
  -H "Authorization: Bearer <TOKEN_ADMIN>" -o ventas.csv
```
**Resultado esperado**:
- Archivo CSV con codificación UTF-8.
- Protección contra inyección de fórmulas (`=`, `+`, `-`, `@` prefijados con comilla simple `'`).

---

## Escenario 3: Modificar configuración operativa y verificar auditoría inmutable
1. Modificar parámetro:
```bash
curl -X PUT "http://localhost:3000/api/admin/config/payments.cash.max_pending_orders" \
  -H "Authorization: Bearer <TOKEN_ADMIN>" \
  -H "Content-Type: application/json" \
  -d '{"value": 4, "description": "Límite ampliado por temporada alta"}'
```
2. Comprobar registro en auditoría:
```bash
curl -X GET "http://localhost:3000/api/admin/audit?entityType=config" \
  -H "Authorization: Bearer <TOKEN_ADMIN>"
```
**Resultado esperado**:
- Parámetro actualizado a `4`.
- Entrada en `reports.audit_log` con `action: "CONFIG_UPDATE"`, `before_state: {"value": 2}`, `after_state: {"value": 4}`.

---

## Escenario 4: Verificar denegación para personal de cafetería (403 Forbidden)
```bash
curl -X GET "http://localhost:3000/api/admin/reports/sales?from=2026-11-01&to=2026-11-07" \
  -H "Authorization: Bearer <TOKEN_PERSONAL>"
```
**Resultado esperado**:
- `403 Forbidden`: Los reportes y la auditoría son exclusivos para administradores.
