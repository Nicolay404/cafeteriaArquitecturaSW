# API Contracts: Administración, reportes y auditoría (Spec #8)

Todos los endpoints requieren encabezado de autorización y rol `admin` (`AdminGuard`). El rol `personal` u otros reciben `403 Forbidden`.

---

## 1. Reporte de ventas por periodo
`GET /api/admin/reports/sales`

### Query Parameters
- `from` (string, ISO-8601 YYYY-MM-DD, obligatorio)
- `to` (string, ISO-8601 YYYY-MM-DD, obligatorio)
- `paymentMethod` (string, opcional: `card` | `cash` | `transfer`)

### Response `200 OK`
```json
{
  "from": "2026-11-01",
  "to": "2026-11-07",
  "totalSalesCents": 125000,
  "totalOrders": 100,
  "averageTicketCents": 1250,
  "salesByDay": [
    {
      "date": "2026-11-01",
      "totalCents": 18000,
      "totalOrders": 15,
      "averageTicketCents": 1200
    }
  ],
  "salesByPaymentMethod": [
    {
      "method": "card",
      "totalCents": 75000,
      "totalOrders": 60,
      "percentage": 60.0
    },
    {
      "method": "cash",
      "totalCents": 30000,
      "totalOrders": 25,
      "percentage": 24.0
    },
    {
      "method": "transfer",
      "totalCents": 20000,
      "totalOrders": 15,
      "percentage": 16.0
    }
  ]
}
```

---

## 2. Ranking de productos más vendidos
`GET /api/admin/reports/top-products`

### Query Parameters
- `from` (string, ISO-8601, obligatorio)
- `to` (string, ISO-8601, obligatorio)
- `limit` (integer, opcional, por defecto 10, máx 100)

### Response `200 OK`
```json
{
  "from": "2026-11-01",
  "to": "2026-11-07",
  "products": [
    {
      "productId": "prod-1",
      "productName": "Café Americano",
      "unitsSold": 150,
      "totalCents": 37500,
      "rankingByUnits": 1,
      "rankingByRevenue": 2
    },
    {
      "productId": "prod-2",
      "productName": "Cappuccino Vainilla",
      "unitsSold": 120,
      "totalCents": 42000,
      "rankingByUnits": 2,
      "rankingByRevenue": 1
    }
  ]
}
```

---

## 3. Reporte de uso de promociones
`GET /api/admin/reports/promotions`

### Query Parameters
- `from` (string, ISO-8601, obligatorio)
- `to` (string, ISO-8601, obligatorio)
- `holidayName` (string, opcional)

### Response `200 OK`
```json
{
  "from": "2026-11-01",
  "to": "2026-11-07",
  "promotions": [
    {
      "promotionId": "promo-navidad-1",
      "promotionName": "Navidad 2026 - 2x1 Espresso",
      "holidayName": "Navidad",
      "timesUsed": 45,
      "totalDiscountCents": 9000,
      "associatedSalesCents": 35000,
      "couponLimit": 100,
      "remainingUses": 55
    }
  ]
}
```

---

## 4. Exportación de reportes
`GET /api/admin/reports/export`

### Query Parameters
- `type` (`sales` | `top-products` | `promotions`, obligatorio)
- `from` (string, ISO-8601, obligatorio)
- `to` (string, ISO-8601, obligatorio)
- `format` (`csv`, obligatorio)

### Response `200 OK`
- Header: `Content-Type: text/csv; charset=utf-8`
- Header: `Content-Disposition: attachment; filename="reporte-{type}-{from}-{to}.csv"`

---

## 5. Consulta y registro de auditoría
`GET /api/admin/audit`

### Query Parameters
- `from` (string, ISO-8601, opcional)
- `to` (string, ISO-8601, opcional)
- `actorId` (string, opcional)
- `entityType` (string, opcional)
- `action` (string, opcional)
- `limit` (integer, opcional, por defecto 50)
- `offset` (integer, opcional, por defecto 0)

### Response `200 OK`
```json
{
  "totalCount": 2,
  "entries": [
    {
      "id": "uuid-1",
      "timestamp": "2026-11-18T10:00:00Z",
      "actorId": "admin-1",
      "actorRole": "admin",
      "action": "PRICE_UPDATE",
      "entityType": "product",
      "entityId": "prod-1",
      "beforeState": { "priceCents": 200 },
      "afterState": { "priceCents": 250 },
      "metadata": { "reason": "Ajuste inflacionario" }
    }
  ]
}
```

---

## 6. Configuración operativa
- `GET /api/admin/config`: Lista parámetros operativos.
- `PUT /api/admin/config/:key`: Actualiza un parámetro y genera automáticamente entrada en `audit_log`.

### Request `PUT /api/admin/config/:key`
```json
{
  "value": 3,
  "description": "Límite máximo de pedidos en efectivo pendientes por cliente"
}
```

### Response `200 OK`
```json
{
  "configKey": "payments.cash.max_pending_orders",
  "configValue": 3,
  "description": "Límite máximo de pedidos en efectivo pendientes por cliente",
  "updatedBy": "admin-1",
  "updatedAt": "2026-11-18T10:05:00Z"
}
```

---

## 7. Resumen operativo del día
`GET /api/admin/overview`

### Response `200 OK`
```json
{
  "todaySalesCents": 45000,
  "todayOrdersDelivered": 32,
  "ordersInProgress": 5,
  "pendingTransferVerifications": 2
}
```
