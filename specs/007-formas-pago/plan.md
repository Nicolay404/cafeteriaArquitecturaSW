# Implementation Plan: Formas de pago (Spec #7)

**Branch**: `feature/spec-7` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `/specs/007-formas-pago/spec.md`

Complementan este plan los artefactos de diseño generados: [research.md](research.md), [data-model.md](data-model.md), [contracts/payment-api.md](contracts/payment-api.md), [contracts/events.md](contracts/events.md) y [quickstart.md](quickstart.md).

---

## Summary

Implementar el módulo de dominio `Pagos` en NestJS (`proyecto/apps/api/src/modules/pagos`) y paquetes de soporte (`packages/contracts`) para soportar tres métodos de pago:
1. **Tarjeta de crédito**: Integración con pasarela de pago externa mediante tokenización y webhooks firmados/deduplicados, dejando a la cafetería fuera del alcance de PCI DSS. En pruebas locales y CI se utiliza `MockPaymentGatewayAdapter`.
2. **Efectivo**: Registro del cobro en mostrador al momento de la entrega por el personal de la cafetería con cálculo automático de cambio y límite configurable de pedidos en efectivo pendientes por cliente.
3. **Transferencia bancaria**: Visualización de datos de cuenta y referencia única; subida y almacenamiento seguro de comprobante (con retención LOPDP); validación manual por el personal.
4. **Reembolsos e Idempotencia**: Manejo de devoluciones automáticas (tarjeta) o manuales (transferencia), deduplicación estricta y patrón Outbox para publicación de eventos a RabbitMQ sin inconsistencias.

---

## Technical Context

**Language/Version**: TypeScript 5.9.3, Node.js >= 24.22.1  
**Primary Dependencies**: NestJS 12.5.1 (`@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`), `pg` (PostgreSQL), `redis` (idempotencia y locks), `amqplib` (RabbitMQ outbox worker), `crypto` (HMAC firmas)  
**Storage**: PostgreSQL (esquema aislado `payments`), Redis (claves de idempotencia y límites operativos)  
**Testing**: Vitest 5.1.0 (unit tests), Jest con Testcontainers (PostgreSQL, Redis, RabbitMQ reales) para integración, ESLint boundaries para fronteras  
**Target Platform**: Render (API NestJS y worker en red privada), Vercel (Next.js frontend)  
**Project Type**: Monorepo modular (NestJS en `apps/api`, contracts en `packages/contracts`, worker en `apps/worker`)  
**Performance Goals**: Confirmación de tarjeta en < 10 segundos (SC-001); latencia de API < 800 ms al confirmar pedidos  
**Constraints**: 0 datos de tarjeta o CVV en nuestros sistemas; importes en enteros en centavos (aritmética monetaria estricta); 0 cobros duplicados en pruebas de fallos y reintentos  
**Scale/Scope**: Módulo `pagos` con 6 tablas en esquema `payments`, endpoints REST, adaptadores de pasarela, outbox worker  

---

## Constitution Check

*GATE: All gates evaluated and passed.*

- [x] **I. Accesibilidad AAA:** Las pantallas y formularios de pago en frontend no imponen límites de tiempo que no se puedan ampliar; las opciones de pago y comprobantes cumplen contraste ≥ 7:1 y navegación total por teclado.
- [x] **II. Seguridad:** Autorización por rol en el servidor (solo `personal` y `admin` pueden verificar transferencias y cobrar efectivo); **ningún dato de tarjeta ni CVV** pasa ni se guarda en nuestros servidores (tokenización); firmas HMAC en webhooks; 0 secretos en el repositorio.
- [x] **III. LOPDP:** Los comprobantes de transferencia contienen PII financiera y cuentan con retención máxima de 90 días (`retention_until`), almacenados con nombres seudonimizados y acceso restringido al personal autorizado.
- [x] **IV. Escalabilidad y consistencia:** Servicios sin estado; transiciones atómicas; patrón Outbox en la misma transacción de Postgres para comunicar cambios a Pedidos y Notificaciones; deduplicación e idempotencia estricta en webhooks y peticiones.
- [x] **V. Límites de dominio:** El módulo Pagos es dueño exclusivo del esquema `payments`; no accede a tablas de `orders`, `customers` ni `identity`. La interacción se realiza únicamente a través de eventos outbox (`pago.confirmado`, `pago.rechazado`) y contratos públicos en `packages/contracts`.
- [x] **VI. Calidad:** TDD obligatorio para la lógica de pagos, estados y aritmética de centavos; cobertura de tests ≥ 95 % para el módulo de pagos (Quality Gate de SonarQube); tests de integración con Testcontainers reales.
- [x] **VII. Reversibilidad:** Migración en `infra/migrations/002_payments_schema.sql` compatible con N−1; división del trabajo en commits atómicos y convencionales (`feat(pagos): ...`); 0 secretos ni dependencias no rastreadas.
- [x] **Plataforma:** TypeScript en todo el stack, sin Python; monorepo pnpm.

---

## Project Structure

### Documentation (this feature)

```text
specs/007-formas-pago/
├── spec.md              # Requisitos y especificación de negocio (original)
├── plan.md              # Este documento de planificación técnica
├── research.md          # Decisiones técnicas, gateway mock, resiliencia y LOPDP
├── data-model.md        # Entidades del esquema payments y máquina de estados
├── quickstart.md        # Guía de ejecución y pruebas de validación
├── contracts/
│   ├── payment-api.md   # Especificación de endpoints REST y webhooks
│   └── events.md        # Eventos outbox de dominio para RabbitMQ
├── checklists/
│   └── requirements.md  # Checklist de calidad de spec
└── tasks.md             # Tareas detalladas generadas con Spec Kit
```

### Source Code Layout

```text
proyecto/
├── packages/contracts/src/
│   ├── index.ts                     # Re-export de contratos públicos
│   └── payments/
│       ├── payment.dto.ts           # DTOs de inicio, cobro, verificación y reembolso
│       ├── payment-events.ts        # Tipos e interfaces de eventos de pago
│       └── index.ts
├── apps/api/src/modules/pagos/
│   ├── index.ts                     # Exportación pública del módulo
│   ├── pagos.module.ts              # NestJS Module con controladores y servicios
│   ├── controllers/
│   │   ├── payments.controller.ts   # Endpoints de cliente y personal
│   │   └── webhook.controller.ts    # Endpoint de webhook de la pasarela
│   ├── services/
│   │   ├── payments.service.ts      # Lógica de estados, idempotencia y outbox
│   │   ├── cash-payment.service.ts  # Lógica de cobro en efectivo y límites
│   │   ├── transfer.service.ts      # Subida de comprobantes y verificación
│   │   └── gateway/
│   │       ├── payment-gateway.port.ts      # Interfaz abstracta del adaptador
│   │       └── mock-gateway.adapter.ts      # Implementación mock para sandbox/tests
│   └── repositories/
│       ├── payment.repository.ts    # Acceso a esquema payments con SQL seguro
│       └── outbox.repository.ts     # Inserción atómica en outbox
├── apps/worker/src/
│   └── outbox-publisher.ts          # Publicación periódica de outbox a RabbitMQ
├── infra/migrations/
│   └── 002_payments_schema.sql      # Migración DDL para esquema payments
└── tests/
    ├── unit/
    │   └── payments/                # Tests unitarios TDD (estados, cálculo de vuelto, firmas)
    └── integration/
        └── payments.int.spec.ts     # Tests de integración con Testcontainers
```

---

## Complexity Tracking

*No se registran violaciones a la Constitución ni complejidades no justificadas.*
