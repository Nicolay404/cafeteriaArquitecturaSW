# Tasks: Administración, reportes y auditoría (Spec #8)

**Input**: Design documents from `/specs/008-administracion-reportes/` (`spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`)  
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/  
**Tests**: Tests are MANDATORY (Constitution VI): every user story includes unit and integration tests. TDD is strictly required for analytical metrics, monetary arithmetic in centavos, and audit log immutability. Cobertura >= 95 % en `apps/api/src/modules/reportes`.

---

## Phase 1: Setup (Shared Contracts & Configuration)

**Purpose**: Shared DTOs, contracts and query interfaces

- [X] T001 Define report DTOs, query filters, audit entities and config contracts in `proyecto/packages/contracts/src/reports/` and re-export in `proyecto/packages/contracts/src/index.ts`

---

## Phase 2: Foundational (Database & Repositories)

**Purpose**: Database schema, persistence, immutability trigger and security guard

- [X] T002 Create database migration `proyecto/infra/migrations/002_reports_schema.sql` defining `reports` schema (`order_projection`, `sales_daily`, `product_sales_daily`, `promotion_usage_daily`, `audit_log`, `operational_config` and immutability trigger for audit log)
- [X] T003 Implement `ReportsRepository` in `proyecto/apps/api/src/modules/reportes/repositories/reports.repository.ts` for aggregated analytical queries
- [X] T004 Implement `AuditRepository` in `proyecto/apps/api/src/modules/reportes/repositories/audit.repository.ts` for immutable audit logging
- [X] T005 Implement `AdminGuard` in `proyecto/apps/api/src/modules/reportes/guards/admin.guard.ts` for role-based access control (403 Forbidden para roles no admin)

**Checkpoint**: Core foundation ready; persistence and security guard operational.

---

## Phase 3: User Story 1 - Ver cómo va el negocio (Priority: P1) 🎯 MVP

**Goal**: El administrador consulta las ventas de un periodo (total, pedidos, ticket medio, desglose diario y por método de pago), ranking de productos más vendidos y puede exportar a CSV seguro.  
**Independent Test**: Con pedidos de prueba sintéticos, consultar las ventas de una semana y comprobar que los totales y rankings coinciden exactamente al centavo.

### Tests for User Story 1 (MANDATORY - Constitution VI) ⚠️
- [X] T006 [P] [US1] Unit tests (TDD) for sales aggregation, ticket medio calculation, and product rankings in `proyecto/apps/api/src/modules/reportes/reportes.spec.ts`
- [X] T007 [P] [US1] Unit tests for CSV export with RFC 4180 compliance and formula injection prevention in `proyecto/tests/unit/reports/csv-exporter.spec.ts`

### Implementation for User Story 1
- [X] T008 [US1] Implement `SalesReportService` in `proyecto/apps/api/src/modules/reportes/services/sales-report.service.ts`
- [X] T009 [US1] Implement `CsvExporterService` in `proyecto/apps/api/src/modules/reportes/services/csv-exporter.service.ts`
- [X] T010 [US1] Implement `ReportsController` endpoints (`GET /sales`, `GET /top-products`, `GET /export`) in `proyecto/apps/api/src/modules/reportes/controllers/reports.controller.ts`

**Checkpoint**: User Story 1 completada y probada de forma independiente.

---

## Phase 4: User Story 2 - Medir las promociones (Priority: P2)

**Goal**: El administrador consulta cuántas veces se usó cada promoción, descuento total y ventas asociadas, agrupado por festividad.  
**Independent Test**: Consultar el reporte de una festividad con promociones aplicadas y verificar usos, descuento total y comparación de ventas.

### Tests for User Story 2 (MANDATORY - Constitution VI) ⚠️
- [X] T011 [P] [US2] Unit tests (TDD) for promotion usage metrics by holiday in `proyecto/apps/api/src/modules/reportes/reportes.spec.ts`

### Implementation for User Story 2
- [X] T012 [US2] Implement promotion analytics query in `SalesReportService` and endpoint `GET /api/admin/reports/promotions` in `ReportsController`

**Checkpoint**: User Story 2 completada y probada de forma independiente.

---

## Phase 5: User Story 3 - Saber quién cambió qué (Priority: P2)

**Goal**: Registro inmutable de auditoría de cambios en precios, menús, promociones, pagos, roles y configuración, filtrable por fecha, autor o tipo de cambio.  
**Independent Test**: Registrar cambios de precio y pagos, consultar auditoría con filtros y verificar inmutabilidad ante intentos de modificación/borrado.

### Tests for User Story 3 (MANDATORY - Constitution VI) ⚠️
- [X] T013 [P] [US3] Unit tests (TDD) for audit log creation, query filtering, and RBAC rejection in `proyecto/apps/api/src/modules/reportes/reportes.spec.ts`

### Implementation for User Story 3
- [X] T014 [US3] Implement `AuditService` in `proyecto/apps/api/src/modules/reportes/services/audit.service.ts`
- [X] T015 [US3] Implement `AuditController` (`GET /api/admin/audit`, `POST /api/admin/audit`) in `proyecto/apps/api/src/modules/reportes/controllers/audit.controller.ts`

**Checkpoint**: User Story 3 completada y probada de forma independiente.

---

## Phase 6: User Story 4 - Operar desde un único panel (Priority: P3)

**Goal**: Resumen operativo del día (ventas hoy, pedidos en curso, verificaciones pendientes) y modificación de parámetros de configuración operativa en caliente con auditoría automática.  
**Independent Test**: Modificar un parámetro operativo y verificar que el cambio se aplica y queda registrado en la auditoría inmutable.

### Tests for User Story 4 (MANDATORY - Constitution VI) ⚠️
- [X] T016 [P] [US4] Unit tests (TDD) for operational config updates and overview summary in `proyecto/apps/api/src/modules/reportes/reportes.spec.ts`

### Implementation for User Story 4
- [X] T017 [US4] Implement `AdminConfigService` in `proyecto/apps/api/src/modules/reportes/services/admin-config.service.ts`
- [X] T018 [US4] Implement `AdminConfigController` (`GET /config`, `PUT /config/:key`, `GET /overview`) in `proyecto/apps/api/src/modules/reportes/controllers/admin-config.controller.ts`

**Checkpoint**: User Story 4 completada y probada de forma independiente.

---

## Phase 7: Polish, Quality Gate & SonarQube Compliance

**Purpose**: Verificación de módulo NestJS, límites arquitectónicos, lint, cobertura >= 95% y SonarQube Quality Gate

- [X] T019 Implement dynamic `ReportesModule.register` and public exports in `proyecto/apps/api/src/modules/reportes/`
- [X] T020 Comprehensive unit test suite in `proyecto/apps/api/src/modules/reportes/reportes.spec.ts` ensuring >= 95% coverage on `apps/api/src/modules/reportes`
- [X] T021 Integration tests in `proyecto/tests/integration/reports.int.spec.ts`
- [X] T022 Execute full test suite (`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`) ensuring 0 errors and Quality Gate compliance
