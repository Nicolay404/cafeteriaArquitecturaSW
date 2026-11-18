# Contract: Payment API & Webhooks

**Branch**: `feature/spec-7` | **Spec**: [spec.md](../spec.md) | **Date**: 2026-11-18

Este documento especifica los contratos HTTP del módulo Pagos (`/api/payments`), sus DTOs de entrada y salida, códigos de estado y encabezados requeridos.

---

## 1. Iniciar Intento de Pago

Inicia el proceso de pago para un pedido creado.

- **Método**: `POST`
- **Ruta**: `/api/payments/intent`
- **Autenticación**: Bearer Token (Cliente autenticado)
- **Encabezados Requeridos**:
  - `Idempotency-Key`: UUID v4
  - `Content-Type`: `application/json`

### Request Body (`CreatePaymentIntentDto`)
```json
{
  "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
  "method": "card", // "card" | "transfer" | "cash"
  "amountCents": 1250,
  "currency": "USD"
}
```

### Respuestas
- **201 Created**:
  ```json
  {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "method": "card",
    "status": "pending",
    "amountCents": 1250,
    "currency": "USD",
    "gatewaySession": {
      "sessionId": "cs_test_a1b2c3d4",
      "redirectUrl": "https://gateway-sandbox.example.com/checkout?session=cs_test_a1b2c3d4"
    },
    "transferDetails": null,
    "cashDetails": null
  }
  ```
- **400 Bad Request**: Validación fallida (monto menor o igual a 0, método inválido).
- **409 Conflict**: Clave de idempotencia duplicada con payload distinto, o el pedido ya está pagado.
- **422 Unprocessable Entity**: Si `method === "cash"` y el cliente superó el límite de pedidos en efectivo pendientes.

---

## 2. Webhook de Pasarela de Pagos (Tarjeta)

Recepción asíncrona de notificaciones desde la pasarela externa.

- **Método**: `POST`
- **Ruta**: `/api/payments/webhook`
- **Autenticación**: Firma HMAC en encabezado (No requiere JWT de usuario)
- **Encabezados Requeridos**:
  - `X-Gateway-Signature`: `<hmac_sha256_signature>`
  - `Content-Type`: `application/json`

### Request Body (`GatewayWebhookDto`)
```json
{
  "eventId": "evt_9918273645",
  "eventType": "payment.succeeded", // "payment.succeeded" | "payment.failed"
  "transactionId": "tx_8817263544",
  "orderReference": "b8a91443-41bb-4f38-a192-34907993a64f",
  "amountCents": 1250,
  "currency": "USD",
  "timestamp": "2026-11-18T12:00:00Z"
}
```

### Respuestas
- **200 OK**:
  ```json
  {
    "received": true,
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "status": "approved"
  }
  ```
- **401 Unauthorized**: Firma HMAC no válida o ausente.
- **200 OK (Duplicado)**: Si el `eventId` ya fue procesado, se retorna 200 sin repetir transiciones (idempotente).

---

## 3. Subir Comprobante de Transferencia (Cliente)

- **Método**: `POST`
- **Ruta**: `/api/payments/:paymentId/receipt`
- **Autenticación**: Bearer Token (Cliente dueño del pedido)
- **Encabezados Requeridos**:
  - `Content-Type`: `multipart/form-data`

### Form Data
- `file`: Archivo binario (JPEG, PNG o PDF, máx 5MB).

### Respuestas
- **201 Created**:
  ```json
  {
    "receiptId": "f7e8d9c0-1a2b-3c4d-5e6f-7a8b9c0d1e2f",
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "fileName": "comprobante.png",
    "status": "pending_verification",
    "uploadedAt": "2026-11-18T12:05:00Z"
  }
  ```
- **413 Payload Too Large**: Archivo mayor a 5 MB.
- **415 Unsupported Media Type**: Tipo de archivo no permitido.

---

## 4. Confirmación de Transferencia (Personal de Cafetería)

- **Método**: `POST`
- **Ruta**: `/api/payments/:paymentId/verify-transfer`
- **Autenticación**: Bearer Token (Rol `personal` o `admin`, con MFA verificado)
- **Encabezados Requeridos**:
  - `Content-Type`: `application/json`

### Request Body (`VerifyTransferDto`)
```json
{
  "action": "approve", // "approve" | "reject"
  "notes": "Comprobante verificado en cuenta bancaria",
  "rejectionReason": null // Obligatorio si action === "reject"
}
```

### Respuestas
- **200 OK**:
  ```json
  {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "status": "approved", // o "rejected"
    "verifiedBy": "staff-user-id",
    "verifiedAt": "2026-11-18T12:10:00Z"
  }
  ```
- **403 Forbidden**: Usuario no tiene rol `personal` ni `admin`.

---

## 5. Registro de Cobro en Efectivo (Personal de Cafetería)

- **Método**: `POST`
- **Ruta**: `/api/payments/:paymentId/collect-cash`
- **Autenticación**: Bearer Token (Rol `personal` o `admin`)
- **Encabezados Requeridos**:
  - `Content-Type`: `application/json`

### Request Body (`CollectCashDto`)
```json
{
  "amountReceivedCents": 2000
}
```

### Respuestas
- **200 OK**:
  ```json
  {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "status": "approved",
    "amountCents": 1250,
    "amountReceivedCents": 2000,
    "changeCents": 750,
    "collectedBy": "staff-user-id",
    "collectedAt": "2026-11-18T12:15:00Z"
  }
  ```
- **400 Bad Request**: `amountReceivedCents` menor a `amountCents`.

---

## 6. Solicitar Reembolso (Cancelación de Pedido)

- **Método**: `POST`
- **Ruta**: `/api/payments/:paymentId/refund`
- **Autenticación**: Bearer Token (`personal`, `admin`, o llamado interno)
- **Encabezados Requeridos**:
  - `Idempotency-Key`: UUID v4
  - `Content-Type`: `application/json`

### Request Body (`RequestRefundDto`)
```json
{
  "amountCents": 1250,
  "reason": "Cliente canceló pedido antes de preparación"
}
```

### Respuestas
- **200 OK**:
  ```json
  {
    "refundId": "ref_11223344",
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "amountCents": 1250,
    "status": "completed", // "completed" en tarjeta (pasarela) o "pending" (tarea manual para transferencia)
    "method": "card_gateway",
    "createdAt": "2026-11-18T12:20:00Z"
  }
  ```
