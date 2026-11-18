# Domain Events Contract — Spec #7: Formas de pago

**Branch**: `feature/spec-7` | **Spec**: [spec.md](../spec.md) | **Date**: 2026-11-18

Este documento define el esquema de los eventos de dominio producidos y consumidos por el módulo de pagos a través de RabbitMQ utilizando el patrón Outbox.

---

## 1. Eventos Emitidos por Pagos

### `pago.confirmado`
Se emite inmediatamente tras la confirmación exitosa de un pago (por tarjeta, transferencia o efectivo).

```json
{
  "eventId": "evt_4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
  "eventName": "pago.confirmado",
  "aggregateType": "payment",
  "aggregateId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
  "timestamp": "2026-11-18T12:00:00Z",
  "version": 1,
  "payload": {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "customerId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "method": "card", // "card" | "transfer" | "cash"
    "amountCents": 1250,
    "currency": "USD",
    "confirmedAt": "2026-11-18T12:00:00Z"
  }
}
```
**Consumidores principales**:
- Módulo `pedidos`: transiciona el estado del pedido a `pagado` y lo encola para cocina.
- Módulo `notificaciones`: envía confirmación por email y WebSocket.
- Módulo `reportes`: actualiza métricas agregadas de ventas.

---

### `pago.rechazado`
Se emite cuando un pago es rechazado (tarjeta denegada o comprobante de transferencia no válido).

```json
{
  "eventId": "evt_5b8e16ea-8b7d-4935-ac37-91627f98a9bb",
  "eventName": "pago.rechazado",
  "aggregateType": "payment",
  "aggregateId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
  "timestamp": "2026-11-18T12:02:00Z",
  "version": 1,
  "payload": {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "customerId": "c1d2e3f4-5a6b-7c8d-9e0f-1a2b3c4d5e6f",
    "method": "card",
    "reason": "Fondos insuficientes o tarjeta rechazada",
    "rejectedAt": "2026-11-18T12:02:00Z"
  }
}
```
**Consumidores**:
- Módulo `notificaciones`: informa al cliente del rechazo para que reintente.

---

### `pago.reembolsado`
Se emite cuando se completa el reembolso de un pago cancelado.

```json
{
  "eventId": "evt_6c9f27fb-9c8e-5046-bd48-02738009bac",
  "eventName": "pago.reembolsado",
  "aggregateType": "payment",
  "aggregateId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
  "timestamp": "2026-11-18T12:20:00Z",
  "version": 1,
  "payload": {
    "paymentId": "4a7f05dc-7a6c-4824-9b26-80516e87f8aa",
    "refundId": "ref_11223344",
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "amountCents": 1250,
    "method": "card_gateway",
    "refundedAt": "2026-11-18T12:20:00Z"
  }
}
```
**Consumidores**:
- Módulo `reportes`: resta el valor de las ventas netas del periodo.
- Módulo `notificaciones`: confirma al cliente la emisión del reembolso.

---

## 2. Eventos Consumidos por Pagos

### `pedido.cancelado`
Emitido por el módulo `pedidos` cuando un pedido es cancelado.

```json
{
  "eventName": "pedido.cancelado",
  "payload": {
    "orderId": "b8a91443-41bb-4f38-a192-34907993a64f",
    "reason": "Cancelado por cliente antes de preparación",
    "cancelledAt": "2026-11-18T12:18:00Z"
  }
}
```
**Acción en Pagos**:
- Si el pago asociado estaba `pending`, se pasa a `cancelled`.
- Si el pago estaba `approved`, se inicia el proceso de reembolso (automático para tarjeta, manual para transferencia).
