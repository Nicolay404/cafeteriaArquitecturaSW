# Implementation Plan: Administración, reportes y auditoría (Spec #8)

**Branch**: `feature/spec-8` | **Date**: 2026-11-18 | **Spec**: [specs/008-administracion-reportes/spec.md](./spec.md)  
**Input**: Feature specification from `specs/008-administracion-reportes/spec.md`

---

## Summary

Implementar el módulo de administración, reportes y auditoría (`apps/api/src/modules/reportes/`) para la cafetería. Provee consultas analíticas desacopladas (ventas por periodo, ticket medio, desglose por método de pago, ranking de productos y efectividad de promociones festivas), exportación segura a CSV RFC 4180 con sanitización contra inyección de fórmulas, registro inmutable de auditoría para cambios críticos (precios, menús, promociones, pagos, roles y parámetros) y gestión de configuración operativa en caliente sin requerir redespliegues.

---

## Technical Context

**Language/Version**: TypeScript 5.9+, Node.js >= 24 (en motor estricto false para Node 24.18)  
**Primary Dependencies**: NestJS 11+, PostgreSQL (pg pool), fast-csv / nativo CSV serializer, Zod / class-validator  
**Storage**: PostgreSQL esquema `reports` (`order_projection`, `sales_daily`, `product_sales_daily`, `promotion_usage_daily`, `audit_log`, `operational_config`)  
**Testing**: Jest (API unit test con cobertura >= 95%), Vitest (unitarios transversales), Testcontainers (integración Postgres)  
**Target Platform**: Linux / macOS (desarrollo local en Docker y verificación CI en GitHub Actions)  
**Project Type**: Monolito modular (módulo `ReportesModule` en `apps/api`)  
**Performance Goals**: Consultas de reportes de hasta un año en < 100 ms (meta spec < 5 s); sin degradación en transacciones concurrentes  
**Constraints**: Todos los valores monetarios en centavos enteros (`amount_cents`); LOPDP: cero PII de clientes en reportes; inmutabilidad garantizada en auditoría; acceso exclusivo `admin`  
**Scale/Scope**: 5 endpoints analíticos y administrativos; 1 esquema relacional; cobertura >= 95% en `apps/api/src/modules/reportes`

---

## Constitution Check

*GATE: All gates passed. Re-checked after design.*

- [x] **I. Accesibilidad AAA:** Los endpoints proveen estructuras tabulares directas para lectura accesible con lectores de pantalla; exportación CSV plana para herramientas asistivas.
- [x] **II. Seguridad:** `AdminGuard` / `RolesGuard` validando rol `admin` en el servidor en cada llamada (HTTP 403 para personal); sanitización estricta de CSV contra inyección de fórmulas (OWASP); cero secretos en el repositorio.
- [x] **III. LOPDP:** Los reportes analíticos utilizan agregados puros o identificadores anonimizados (`customerId` pseudo-anonimizado); no se almacena ni expone PII en `reports`. Auditoría inmutable de 5 años.
- [x] **IV. Escalabilidad y consistencia:** Servicios sin estado; modelo analítico desacoplado en esquema `reports` para no bloquear tablas transaccionales de pedidos ni pagos; cálculos monetarios estrictamente en centavos enteros en el servidor.
- [x] **V. Límites de dominio:** `ReportesModule` es dueño de su esquema `reports`. No consulta directamente esquemas de `pedidos` ni `pagos`; utiliza proyecciones analíticas y contratos públicos. Fronteras validadas por `eslint-plugin-boundaries`.
- [x] **VI. Calidad:** TDD riguroso en cálculos analíticos y auditoría; suite de pruebas unitarias completas en `apps/api/src/modules/reportes/reportes.spec.ts` y en `tests/unit/reports/`; cobertura objetivo >= 95% en el módulo.
- [x] **VII. Reversibilidad:** Migración `infra/migrations/002_reports_schema.sql` atómica; commits atómicos con formato Conventional Commits con scope `(reportes)`.

---

## Project Structure

### Documentation (`specs/008-administracion-reportes/`)
```text
specs/008-administracion-reportes/
├── spec.md              # Requisitos y escenarios de aceptación
├── plan.md              # Este documento
├── research.md          # Decisiones de arquitectura y CQRS
├── data-model.md        # Esquema relacional reports
├── quickstart.md        # Guía rápida de pruebas y escenarios
├── contracts/
│   └── reports-api.md   # Especificación de endpoints REST y respuestas
└── tasks.md             # Lista ordenada de tareas de implementación
```

### Source Code
```text
proyecto/
├── packages/
│   └── contracts/src/
│       ├── reports/
│       │   ├── reports.dto.ts
│       │   └── index.ts
│       └── index.ts
├── apps/api/src/modules/reportes/
│   ├── config.ts
│   ├── index.ts
│   ├── reportes.module.ts
│   ├── reportes.spec.ts
│   ├── controllers/
│   │   ├── reports.controller.ts
│   │   ├── audit.controller.ts
│   │   └── admin-config.controller.ts
│   ├── services/
│   │   ├── sales-report.service.ts
│   │   ├── audit.service.ts
│   │   ├── admin-config.service.ts
│   │   └── csv-exporter.service.ts
│   ├── repositories/
│   │   ├── reports.repository.ts
│   │   └── audit.repository.ts
│   └── guards/
│       └── admin.guard.ts
├── infra/migrations/
│   └── 002_reports_schema.sql
└── tests/
    ├── unit/reports/
    │   ├── sales-report.spec.ts
    │   ├── audit.spec.ts
    │   └── csv-exporter.spec.ts
    └── integration/
        └── reports.int.spec.ts
```
