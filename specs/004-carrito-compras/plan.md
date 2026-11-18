# Implementation Plan: Carrito de compras

**Branch**: `feature/spec-4` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/004-carrito-compras/spec.md`

## Summary

RF-03: cada cliente tiene un único carrito activo, que se conserva entre sesiones y dispositivos y
se vacía tras 30 días sin actividad. El cliente añade, cambia cantidades, quita (con deshacer) y
vacía. Los precios y descuentos los calcula siempre el servidor, y el carrito avisa de productos
agotados, retirados, fuera de horario, con precio cambiado o de promociones terminadas.

Enfoque: el núcleo es un **dominio puro** dentro de `modules/carrito`:
- operaciones sobre las líneas, con límites y deshacer;
- caducidad por inactividad;
- cálculo de avisos, que compara lo que el cliente vio con el estado actual.

El carrito guarda solo `productoId`, `cantidad` y la «última vista» de cada línea (precio y
promociones que se mostraron). Nunca guarda un precio que el cliente pueda imponer. Para mostrarlo
consulta Catálogo (datos y disponibilidad) y Promociones (`cotizar`) a través de **puertos propios
del Carrito**. Los adaptadores reales a esos módulos se conectan solo cuando sus interfaces estén
integradas en `main`.

## Dependencias con otros specs

| Necesita | De | Para qué | Estado (2026-11-18) |
|---|---|---|---|
| Base del monorepo, límites, migraciones, Testcontainers | Spec 1 | Todo | Integrado en `main` |
| `clienteId` de la sesión autenticada (guard de rol `cliente`) | Spec 2 Identidad | Endpoints HTTP (FR-001) | **Bloqueado**: `feature/spec-2` publica la cookie `sid` y `GET /auth/sesion`, pero aún no una interfaz entre módulos para obtener el `clienteId`. **Coordinar.** |
| Evento `cliente.eliminado` | Spec 2 Clientes | Borrar el carrito (LOPDP) | Anunciado en el contrato de `feature/spec-2`; sin integrar |
| Datos públicos del producto: precio vigente, categorías, menú, disponibilidad, existencias, horario | Spec 3 Catálogo | Validar, limitar y avisar (FR-006, FR-008) | **Bloqueado**: sin rama ni interfaz |
| `PromocionesApi.cotizar` | Spec 5 Promociones | Precios con descuento (FR-004, FR-005) | Contrato en borrador en `feature/spec-5` (PR sin fusionar) |
| Confirmación del pedido y vaciado | Spec 6 Pedidos | Consumidor de `CarritoApi` | Lo define este spec |

Lo que **no** depende de nadie: el dominio (US1 operaciones, US2 caducidad y concurrencia, US3
cálculo de avisos) y la persistencia propia (Redis + esquema `cart`). Los puertos
`CatalogoParaCarrito` y `PreciosParaCarrito` los define el Carrito como consumidor: describen lo
que necesita, **no** son el contrato de Catálogo ni de Promociones, y se ajustarán al contrato
real cuando esos módulos lo publiquen.

## Technical Context

**Language/Version**: TypeScript 5.9.3 en Node 24.22.1 (ESM)
**Primary Dependencies**: NestJS 12.5.1 (`CarritoModule`), `redis` 6.3.1, `pg` 8.23.1. Sin dependencias nuevas.
**Storage**: Redis (documento del carrito por cliente, lectura rápida) con respaldo durable en PostgreSQL, esquema `cart` (bloque de migraciones 030–039, reservado por la plataforma).
**Testing**: Jest (dominio, TDD), Testcontainers con Redis y Postgres reales, Playwright + axe para la página del carrito.
**Target Platform**: API NestJS y web Next.js, en local con Docker (`alcance-local.md`).
**Project Type**: monolito modular web.
**Performance Goals**: total visible < 1 s tras cada cambio (SC-001); mismo carrito en todos los dispositivos < 5 s (SC-002).
**Constraints**: un carrito por cliente; ≤ 20 unidades por producto y ≤ 50 por carrito (configurables); 30 días de inactividad; precios solo del servidor; WCAG 2.2 AAA.
**Scale/Scope**: un carrito activo por cliente; picos de festividades (lecturas y escrituras frecuentes).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Accesibilidad AAA:** cambios y avisos anunciados con `aria-live="polite"` sin mover el foco (FR-009, US3.4); deshacer sin límite de tiempo; objetivos ≥ 44×44 px; verificación con axe y lector de pantalla. La UI espera la aprobación visual del equipo.
- [x] **II. Seguridad:** el `clienteId` sale siempre de la sesión, nunca del cuerpo; el cliente solo envía `productoId` y `cantidad`; validación de entradas; un cliente no puede leer ni tocar el carrito de otro.
- [x] **III. LOPDP:** el carrito guarda solo `clienteId` (identificador) y productos, sin PII; se borra a los 30 días de inactividad y al recibir `cliente.eliminado`. Añadir «contenido del carrito» al inventario de datos con finalidad y retención.
- [x] **IV. Escalabilidad y consistencia:** API sin estado (carrito en Redis/Postgres); concurrencia optimista por versión; las operaciones son comandos idempotentes sobre el estado más reciente; el precio lo calcula siempre el servidor.
- [x] **V. Límites de dominio:** solo esquema `cart` y claves Redis `carrito:*`; Catálogo, Promociones e Identidad solo por puertos y sus `index.ts`. Sin dependencias nuevas.
- [x] **VI. Calidad:** TDD del dominio; integración con Redis y Postgres reales; E2E del flujo del carrito con teclado y axe; cobertura ≥ 80 %.
- [x] **VII. Reversibilidad:** migración aditiva `030_cart`; endpoints y página detrás del flag `carrito-habilitado`; commits por bloque.
- [x] **Plataforma:** TypeScript, sin Python, local con Docker.

Re-evaluación post-diseño: sin violaciones.

## Project Structure

### Documentation (this feature)

```text
specs/004-carrito-compras/
├── plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/
│   ├── carrito-http.md      # endpoints para la web (bloqueados por Identidad)
│   ├── carrito-api.md       # interfaz para Pedidos (006)
│   └── puertos.md           # lo que Carrito necesita de Catálogo y Promociones
└── checklists/requirements.md
```

### Source Code

```text
proyecto/
├── apps/api/src/modules/carrito/
│   ├── index.ts                     # CarritoModule, CarritoApi y tipos públicos
│   ├── dominio/
│   │   ├── carrito.ts               # operaciones, límites, deshacer, caducidad (FR-001..003, FR-008)
│   │   ├── avisos.ts                # comparación vista ↔ actual (FR-006, FR-007)
│   │   └── *.spec.ts
│   ├── aplicacion/
│   │   ├── puertos.ts               # CatalogoParaCarrito, PreciosParaCarrito, AlmacenCarritos, Reloj
│   │   └── carrito.service.ts       # casos de uso y vista del carrito
│   └── infraestructura/
│       ├── almacen-redis-postgres.ts  # Redis + respaldo en el esquema cart
│       └── (adaptadores a Catálogo y Promociones cuando se integren)
├── apps/web/src/app/carrito/        # página del carrito (tras aprobación visual)
├── infra/migrations/030_cart.sql
└── tests/integration/carrito-*.int.spec.ts
```

**Structure Decision**: igual que Promociones, todo dentro de `modules/carrito` con dominio puro,
puertos en `aplicacion` e infraestructura aparte. Los tests unitarios van junto al código (Jest de API).

**Archivos compartidos**: no se editan `CLAUDE.md`, workflows, Docker ni el registro de módulos sin
coordinar. La migración usa el bloque 030–039 que reserva `infra/migrations/README.md`, todavía en
`feature/spec-2`.

## Complexity Tracking

Sin violaciones.
