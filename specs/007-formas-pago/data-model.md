# Data Model — Spec #7: Formas de pago

**Branch**: `feature/spec-7` | **Spec**: [spec.md](spec.md) | **Date**: 2026-11-18

Este documento define el modelo de datos para el módulo `Pagos` en el esquema PostgreSQL `payments`.

---

## 1. Esquema Relacional (`payments`)

```mermaid
erDiagram
  PAYMENT ||--o| IDEMPOTENCY_KEY : "idempotencia"
  PAYMENT ||--o| TRANSFER_RECEIPT : "tiene comprobante"
  PAYMENT ||--o{ REFUND : "reembolsos"
  PAYMENT ||--o{ PAYMENT_AUDIT_LOG : "auditoría"
  PAYMENT ||--o{ OUTBOX_EVENT : "eventos outbox"

  PAYMENT {
    uuid id PK
    uuid order_id UK "Referencia al pedido en orders"
    uuid customer_id "Referencia al cliente en customers"
    varchar method "card | cash | transfer"
    varchar status "pending | approved | rejected | cancelled | refunded"
    integer amount_cents "Monto exacto en centavos USD"
    varchar currency "USD"
    varchar external_reference "ID de transacción de la pasarela"
    varchar idempotency_key "Clave de idempotencia asociada"
    varchar failure_reason "Motivo en caso de rechazo o error"
    timestamptz created_at
    timestamptz updated_at
  }

  IDEMPOTENCY_KEY {
    varchar key PK
    uuid payment_id FK
    varchar action "initiate | webhook | confirm | refund"
    text request_hash
    jsonb response_body
    integer response_status
    timestamptz created_at
    timestamptz expires_at
  }

  TRANSFER_RECEIPT {
    uuid id PK
    uuid payment_id FK
    varchar file_name "Nombre del archivo seguro (UUID)"
    varchar original_name "Nombre original del comprobante"
    varchar mime_type "image/jpeg, image/png, application/pdf"
    bigint file_size_bytes
    varchar status "pending_verification | verified | rejected"
    uuid verified_by "ID de usuario del personal (personal/admin)"
    text rejection_reason
    timestamptz verified_at
    timestamptz created_at
    timestamptz retention_until "Fecha máxima de retención LOPDP"
  }

  REFUND {
    uuid id PK
    uuid payment_id FK
    integer amount_cents "Monto reembolsado en centavos"
    varchar status "pending | completed | failed"
    varchar method "card_gateway | manual_transfer | cash_desk"
    varchar external_refund_id "ID de reembolso devuelto por la pasarela"
    text reason "Motivo de la cancelación o devolución"
    uuid requested_by "ID del actor que solicitó el reembolso"
    timestamptz created_at
    timestamptz completed_at
  }

  PAYMENT_AUDIT_LOG {
    uuid id PK
    uuid payment_id FK
    varchar action "created | approved | rejected | cancelled | refund_requested | refund_completed"
    uuid actor_id "ID del usuario o SYSTEM"
    varchar actor_role "cliente | personal | admin | system | gateway_webhook"
    jsonb metadata "Detalles de la acción (vuelto, motivo, IP)"
    timestamptz created_at
  }

  OUTBOX_EVENT {
    uuid id PK
    varchar event_name "pago.confirmado | pago.rechazado | pago.reembolsado"
    varchar aggregate_type "payment"
    uuid aggregate_id
    jsonb payload
    varchar status "pending | published | failed"
    integer retry_count
    timestamptz created_at
    timestamptz processed_at
  }
```

---

## 2. Máquina de Estados del Pago (`PaymentStatus`)

```mermaid
stateDiagram-v2
  [*] --> pending : Iniciar pago (tarjeta/efectivo/transferencia)
  
  pending --> approved : Webhook de tarjeta aprobado / Personal confirma transferencia / Cobro en entrega de efectivo
  pending --> rejected : Tarjeta rechazada / Personal rechaza comprobante de transferencia
  pending --> cancelled : Timeout de espera (30m) / Cliente cancela pedido no preparado
  
  approved --> refunded : Cancelación posterior / Reembolso aprobado (parcial o total)
  
  rejected --> [*]
  cancelled --> [*]
  refunded --> [*]
```

### Reglas de Transición:
1. `pending -> approved`:
   - En **tarjeta**: solo por webhook verificado con firma de la pasarela o consulta de estado en sandbox.
   - En **transferencia**: solo por usuario con rol `personal` o `admin` tras validar comprobante.
   - En **efectivo**: solo por usuario con rol `personal` al marcar pedido entregado en mostrador.
   - Dispara la inserción del evento `pago.confirmado` en `payments.outbox`.
2. `pending -> rejected`:
   - En **tarjeta**: pasarela reporta fondos insuficientes o rechazo.
   - En **transferencia**: personal rechaza el comprobante con motivo documentado.
   - El pedido asociado puede reintentar con otra forma de pago antes del timeout.
3. `pending -> cancelled`:
   - El plazo de pago (30 min) expiró o el cliente canceló su pedido antes de pagar.
4. `approved -> refunded`:
   - El pedido se canceló tras haber sido pagado; se genera un registro en `payments.refund`.
   - En tarjeta: se invoca el reembolso a la pasarela externa.
   - En transferencia: queda registrado como tarea manual para el personal contable.

---

## 3. Validaciones y Restricciones de Dominio

1. **Aritmética Monetaria**:
   - `amount_cents` DEBE ser un número entero positivo (`amount_cents > 0`).
   - La suma de reembolsos asociados a un pago NUNCA debe exceder el `amount_cents` original.
2. **Idempotencia Estricta**:
   - Un `order_id` solo puede tener un pago activo en estado `pending` o `approved`.
   - Cualquier intento de invocar confirmación sobre un pago ya `approved` no realiza cambios en base de datos y retorna el estado actual idempotentemente.
3. **Seguridad y Privacidad**:
   - Ninguna columna almacena números de tarjeta, CVV, ni claves bancarias del cliente.
   - Los archivos de comprobante subidos se validan por tipo MIME (`image/jpeg`, `image/png`, `application/pdf`) y tamaño máximo (5 MB).
   - `retention_until` se fija automáticamente a `NOW() + INTERVAL '90 days'`.
