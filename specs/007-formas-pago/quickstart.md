# Quickstart & Verification Guide — Spec #7: Formas de pago

**Branch**: `feature/spec-7` | **Spec**: [spec.md](spec.md) | **Date**: 2026-11-18

Esta guía documenta los escenarios de validación ejecutables para verificar el módulo de Pagos en entorno local y de pruebas, usando mocks de pasarela (sandbox), sin credenciales reales ni datos de tarjetas reales.

---

## 1. Prerrequisitos

Desde la raíz Git (`cafeteriaArquitecturaSW`), posicionarse en `proyecto/`:

```bash
cd proyecto
node --version # >= 24.22.1
pnpm install --frozen-lockfile
```

---

## 2. Variables de Entorno de Prueba

En `proyecto/.env` o variables de entorno locales:
```bash
PAYMENT_GATEWAY_PROVIDER=mock # usa MockPaymentGatewayAdapter para pruebas locales
PAYMENT_GATEWAY_WEBHOOK_SECRET=test_webhook_secret_key_12345
MAX_PENDING_CASH_ORDERS=2
TRANSFER_RECEIPT_MAX_MB=5
```

---

## 3. Escenarios de Prueba Verificables

### Escenario 1: Flujo de Tarjeta Aprobada (Mock Sandbox)
1. **Petición**: `POST /api/payments/intent` con método `"card"`, `amountCents: 1500`, `orderId: <UUID>`.
2. **Resultado esperado**: Estado `201 Created`, status `"pending"`, URL de redirección a mock gateway.
3. **Petición**: `POST /api/payments/webhook` con payload firmado `payment.succeeded` y el ID de orden anterior.
4. **Resultado esperado**:
   - HTTP 200 OK.
   - Pago transiciona a `"approved"`.
   - Registro en `payments.outbox` con evento `pago.confirmado`.
   - Consulta `GET /api/payments/:paymentId` retorna status `"approved"`.

### Escenario 2: Deduplicación e Idempotencia de Webhook
1. **Acción**: Enviar el mismo webhook del Escenario 1 una segunda vez con el mismo `eventId`.
2. **Resultado esperado**:
   - HTTP 200 OK con bandera de duplicado (`received: true`).
   - 0 cobros adicionales, 0 transiciones repetidas y 0 eventos outbox adicionales generados.

### Escenario 3: Rechazo de Webhook no Firmado o Falsificado
1. **Acción**: Enviar `POST /api/payments/webhook` con cabecera `X-Gateway-Signature: firma_invalida`.
2. **Resultado esperado**: HTTP 401 Unauthorized, el pago permanece en su estado anterior.

### Escenario 4: Flujo de Pago en Efectivo y Límite por Cliente
1. **Petición**: `POST /api/payments/intent` con método `"cash"`, `amountCents: 850`.
2. **Petición**: Personal invoca `POST /api/payments/:paymentId/collect-cash` con `amountReceivedCents: 1000`.
3. **Resultado esperado**:
   - HTTP 200 OK.
   - Estado `"approved"`.
   - `changeCents: 150`.
   - Evento outbox `pago.confirmado`.
4. **Verificación de límite**: Si el cliente intenta abrir un 3er pedido en efectivo cuando ya tiene 2 pendientes, el endpoint retorna HTTP 422 Unprocessable Entity.

### Escenario 5: Flujo de Transferencia y Verificación
1. **Petición**: `POST /api/payments/intent` con método `"transfer"`, `amountCents: 2500`.
2. **Resultado**: Recibe datos de cuenta bancaria y referencia única.
3. **Petición**: `POST /api/payments/:paymentId/receipt` subiendo archivo de prueba `comprobante.png`.
4. **Resultado**: Estado del comprobante `"pending_verification"`.
5. **Petición**: Personal invoca `POST /api/payments/:paymentId/verify-transfer` con `"action": "approve"`.
6. **Resultado**: Pago pasa a `"approved"`.

### Escenario 6: Reembolso Idempotente
1. **Petición**: `POST /api/payments/:paymentId/refund` sobre un pago aprobado de tarjeta.
2. **Resultado esperado**:
   - HTTP 200 OK.
   - Mock gateway registra la devolución.
   - Pago pasa a estado `"refunded"`.
   - Evento outbox `pago.reembolsado`.
3. **Reintento**: Segunda petición idéntica con la misma `Idempotency-Key` devuelve el reembolso previo sin duplicar.

---

## 4. Ejecución de Tests Automatizados

```bash
# Tests unitarios del módulo de pagos (TDD de lógica monetaria, estados, adaptadores mock)
pnpm test:unit

# Tests de integración contra Postgres y Redis con Testcontainers
pnpm test:integration

# Verificación de lint y fronteras de módulos
pnpm lint
pnpm typecheck
```
