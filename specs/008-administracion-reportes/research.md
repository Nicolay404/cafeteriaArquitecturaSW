# Research & Technical Decisions: Administración, reportes y auditoría (Spec #8)

## Decision 1: Modelo de lectura desacoplado y rendimiento (FR-002, FR-007, SC-005)

### Contexto
El principio V de la Constitución establece que cada módulo es dueño exclusivo de su esquema de base de datos y prohíbe consultas cruzadas directas a tablas de otros módulos. Además, el requisito FR-007 y criterio SC-005 exigen que la generación de reportes analíticos pesados no degrade el rendimiento de la tienda ni bloquee tablas transaccionales de pedidos o pagos.

### Alternativas consideradas
1. **Consultas analíticas directas a tablas de `pedidos` y `pagos`**:
   - *Desventaja*: Viola el Principio V (fronteras de dominio) y arriesga contención de locks en picos de venta.
2. **Event-driven CQRS / Proyecciones en esquema `reports`**:
   - *Ventajas*: Mantiene desacoplamiento estricto. El módulo `reportes` consume eventos de dominio (`pedido.entregado`, `pago.confirmado`, `pago.reembolsado`, `promocion.aplicada`) y alimenta tablas de agregación optimizadas (`reports.order_projection`, `reports.sales_daily`, `reports.product_sales_summary`, `reports.promotion_usage_summary`).
   - *Rendimiento*: Las consultas analíticas se ejecutan sobre índices agregados en milisegundos (< 100 ms), cumpliendo con holgura SC-001 (< 5 segundos).

### Decisión
Implementar un modelo de proyección analítica en el esquema `reports`. Se provee un servicio de ingestión de eventos/proyección `ReportProjectionService` y un repositorio analítico `ReportsRepository`. Para pruebas locales y cuando los módulos externos no están desplegados, se admiten proyecciones generadas con datos sintéticos representativos.

---

## Decision 2: Registro inmutable de auditoría (FR-008, US3, SC-003)

### Contexto
El negocio requiere trazabilidad estricta de cambios en precios, menús, promociones, pagos, roles y parámetros de configuración, con imposibilidad de borrado o alteración.

### Decisión
Crear la tabla `reports.audit_log` con:
- `id` (UUIDv7 / UUID).
- `timestamp` (TIMESTAMPTZ con valor por defecto `NOW()`).
- `actor_id` (string) y `actor_role` (string: `admin`, `personal`, `system`).
- `action` (string: `PRICE_UPDATE`, `MENU_UPDATE`, `PROMO_UPDATE`, `PAYMENT_STATUS_CHANGE`, `CONFIG_UPDATE`, `USER_ROLE_CHANGE`).
- `entity_type` (string: `product`, `menu`, `promotion`, `payment`, `user`, `config`).
- `entity_id` (string).
- `before_state` (JSONB) y `after_state` (JSONB).
- `ip_address` y `user_agent` (opcionales para auditoría de red).

Se garantiza inmutabilidad mediante un trigger PostgreSQL (`BEFORE UPDATE OR DELETE ON reports.audit_log FOR EACH ROW EXECUTE FUNCTION reports.prevent_audit_modification()`) que aborta cualquier intento de modificación o borrado de registros de auditoría.

---

## Decision 3: Exportación en formato de hoja de cálculo (FR-005, US1)

### Contexto
Los reportes de ventas, productos y promociones deben poder exportarse para su posterior análisis o conciliación contable sin introducir dependencias binarias pesadas.

### Decisión
Implementar exportación en formato **CSV RFC 4180** estructurado con codificación UTF-8 y BOM para compatibilidad directa con Microsoft Excel, LibreOffice y Google Sheets.
- **Protección contra inyección de fórmulas (CSV Injection)**: Toda celda que comience con `=`, `+`, `-`, `@` o caracteres de control de fórmulas se escapa anteponiendo una comilla simple (`'`), neutralizando vulnerabilidades OWASP.
- **Formato monetario**: Valores en formato decimal con punto (ej. `12.50`) calculados a partir de los enteros en centavos (`amount_cents`).

---

## Decision 4: Control de acceso por roles y privacidad (FR-006, FR-009, Principios II y III)

### Contexto
Solo los administradores pueden consultar reportes, métricas y auditoría. El personal de cafetería tiene acceso denegado (HTTP 403 Forbidden). Los reportes no deben exponer PII (nombres, correos o teléfonos de clientes).

### Decisión
- **Guardia de autorización**: `AdminGuard` / `RolesGuard` validando el rol `admin` en el token / contexto de seguridad.
- **Anonimización LOPDP**: Los datos de clientes se agregan únicamente a nivel de conteos, totales o identificadores pseudo-anonimizados (`customerId` UUID o anónimo en pedidos de usuarios que eliminaron su cuenta). No se incluye ningún atributo personal (nombres, emails, teléfonos).

---

## Decision 5: Configuración operativa en caliente (FR-010, US4)

### Contexto
Los administradores deben poder modificar límites operativos (como el límite de pedidos en efectivo pendientes, habilitación de métodos de pago o plazos de verificación) sin necesidad de reiniciar la API ni desplegar.

### Decisión
Crear la tabla `reports.operational_config` con clave-valor (`config_key`, `config_value`, `description`, `updated_by`, `updated_at`). Todo cambio realizado a través de la API `PUT /api/admin/config/:key` registra automáticamente una entrada en `reports.audit_log`.
