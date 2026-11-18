# Research & Technical Decisions — Spec #7: Formas de pago

**Branch**: `feature/spec-7` | **Spec**: [spec.md](spec.md) | **Date**: 2026-11-18

Este documento consolida las decisiones técnicas, patrones de arquitectura y justificaciones para la implementación del módulo de pagos conforme a la Constitución del Proyecto Cafetería (`.specify/memory/constitution.md`) y `promtp.md`.

---

## 1. Integración con Pasarela de Pago Externa (Tarjeta)

### Contexto
El requisito RF-05 y el Principio II (Seguridad por diseño) exigen que los pagos con tarjeta de crédito se procesen mediante una pasarela externa con tokenización (campos alojados o redirección), dejando a nuestros servidores completamente **fuera del alcance de PCI DSS** (SAQ A).

### Decisión
- **Patrón Adapter / Gateway Provider**: Diseñar una interfaz abstracta `PaymentGatewayAdapter` que abstrae las operaciones del proveedor externo:
  - `createPaymentSession(orderId, amountCents, currency, customerId): Promise<{ sessionId: string, redirectUrl: string }>`
  - `verifyWebhookSignature(payload: string, signature: string): boolean`
  - `queryPaymentStatus(transactionId: string): Promise<GatewayPaymentStatus>`
  - `processRefund(transactionId: string, amountCents: number, reason: string): Promise<GatewayRefundResult>`
- **Entorno Sandbox / Mock**: Se implementa un `MockPaymentGatewayAdapter` para entornos de pruebas locales, integración (CI) y preview, con tarjetas de prueba deterministas (aprobada, rechazada por fondos, fallo de pasarela). En staging/producción se inyectará el adaptador del proveedor real mediante variables de entorno cifradas (`PAYMENT_GATEWAY_API_KEY`, `PAYMENT_GATEWAY_WEBHOOK_SECRET`).
- **Resiliencia (Circuit Breaker y Timeout)**:
  - Timeout estricto de 5 segundos hacia llamadas síncronas a la pasarela.
  - Circuit Breaker con ventana deslizante para evitar cascadas de fallos si la pasarela se degrada.
  - Si la pasarela está no disponible, el cliente recibe un error amigable indicando que intente más tarde o elija otra forma de pago (efectivo o transferencia), sin afectar la navegación del menú ni la disponibilidad del sistema.

### Alternativas descartadas
- *Procesar datos de tarjeta en el backend*: Descartado rotundamente por violar el Principio II de la Constitución y la normativa PCI DSS.
- *Confirmar pagos únicamente por redirección en el navegador del cliente*: Descartado porque el usuario puede cerrar la ventana antes de redirigir, o falsificar parámetros de retorno. La confirmación oficial solo ocurre mediante webhook firmado de servidor a servidor o polling de reconciliación.

---

## 2. Idempotencia y Consistencia (Principio IV)

### Contexto
Las pasarelas envían webhooks con reintentos automáticos (*at-least-once delivery*), y los clientes pueden pulsar múltiples veces el botón de pago o refrescar la página ante pérdidas de red. No se puede cobrar ni confirmar un pedido dos veces.

### Decisión
- **Deduplicación por Clave de Idempotencia**:
  - Tabla `payments.idempotency_keys` con clave única, hash del cuerpo de la petición y resultado de la operación.
  - Para webhooks: deduplicación basada en `eventId` único emitido y firmado por la pasarela. Si el evento ya fue procesado, se responde inmediatamente `200 OK` sin re-ejecutar transiciones ni emitir eventos duplicados.
  - Para transferencias y efectivo: operaciones protegidas por clave de idempotencia generada en el cliente o correlacionada con el `payment_id`.
- **Transiciones Atómicas y Bloqueo Optimista**:
  - Máquina de estados en base de datos: el estado de un pago solo puede pasar de `pending` a `approved`, `rejected` o `cancelled`. Un intento de transición desde un estado terminal es no-op idempotente.
  - Cada actualización verifica el estado actual (`UPDATE payments SET status = 'approved' WHERE id = $1 AND status = 'pending'`).

---

## 3. Patrón Outbox para Notificaciones y Pedidos (Principio IV y V)

### Contexto
Cuando un pago se confirma, otros módulos necesitan reaccionar:
- `pedidos`: avanzar el pedido de `pendiente_pago` a `pagado`.
- `notificaciones`: enviar correo de confirmación al cliente.
- `reportes` / `auditoria`: registrar la venta y el movimiento contable.
No se pueden hacer llamadas distribuidas no transaccionales porque fallarían ante caídas parciales.

### Decisión
- **Patrón Outbox Transaccional**:
  - En la misma transacción de PostgreSQL donde se actualiza el estado del pago, se inserta una fila en `payments.outbox` con el evento `pago.confirmado`.
  - Un proceso worker en segundo plano lee la tabla outbox y publica los mensajes a RabbitMQ con reintentos y dead-letter queue (DLQ).
  - Los consumidores en otros módulos reciben el evento de forma asíncrona e idempotente.

---

## 4. Transferencias Bancarias y Protección de Datos Personales LOPDP (Principio III)

### Contexto
El usuario sube un comprobante de transferencia bancaria que contiene datos personales y financieros (nombres, números de cuenta de origen, fecha/hora, banco emisor). El personal de la cafetería debe visualizar el comprobante para aprobar o rechazar el pago.

### Decisión
- **Almacenamiento y Acceso Restringido**:
  - El archivo del comprobante se almacena en almacenamiento seguro de objetos o ruta protegida con nombre seudonimizado (UUID), nunca en carpetas públicas accesibles sin autenticación.
  - Solo usuarios con rol `personal` o `admin` con sesión activa pueden visualizar el comprobante.
- **Política de Retención y Minimización LOPDP**:
  - Campo `retention_until` en `payments.transfer_receipts`: por defecto 90 días después de la entrega o cancelación del pedido (plazo para reclamos y conciliación).
  - Tarea periódica de purga que borra físicamente el archivo del comprobante y anonimiza la referencia en la base de datos una vez cumplido el plazo de retención.
  - El módulo de pagos nunca solicita datos bancarios adicionales al cliente, únicamente el comprobante de la transacción.

---

## 5. Pagos en Efectivo y Control Operativo

### Contexto
En pagos en efectivo, el pedido se prepara y se cobra al retirar en el local. Si clientes maliciosos hacen múltiples pedidos en efectivo y no los retiran, se genera merma y desperdicio de producto.

### Decisión
- **Límite de Pedidos en Efectivo Pendientes**:
  - Parámetro de configuración operativa: `max_pending_cash_orders_per_customer` (por defecto 2 pedidos).
  - Antes de autorizar un nuevo pedido con método efectivo, se verifica cuántos pedidos activos en efectivo tiene el cliente en estados `pending_payment`, `in_preparation` o `ready`. Si alcanza el límite, se bloquea la opción de efectivo y se exige tarjeta o transferencia.
- **Registro de Cobro en Mostrador**:
  - El personal introduce el monto recibido en centavos (`amount_received_cents`).
  - El sistema valida que `amount_received_cents >= total_amount_cents`, calcula el vuelto/cambio (`change_cents = amount_received_cents - total_amount_cents`), marca el pago como `approved` y emite el evento de cobro.

---

## 6. Moneda y Precisión Aritmética (Principio VI)

### Contexto
El sistema maneja dólares estadounidenses (USD). Los números en coma flotante (`float`, `double`, `number` estándar de JS) sufren errores de redondeo binario inaceptables para transacciones monetarias (ej. `0.1 + 0.2 === 0.30000000000000004`).

### Decisión
- **Todos los montos se almacenan y operan como enteros en centavos** (`amount_cents: number` en TypeScript, `integer` o `bigint` en PostgreSQL).
- \$10.50 USD se representa como `1050`.
- Las divisiones o cálculos porcentuales aplican redondeo bancario (medio al par o hacia abajo con resto) garantizando que no se ganen ni pierdan centavos.
