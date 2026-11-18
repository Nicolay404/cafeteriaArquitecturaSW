---
description: "Tareas del spec 004 — Carrito de compras"
---

# Tasks: Carrito de compras

**Input**: `specs/004-carrito-compras/` (plan.md, spec.md, research.md, data-model.md, contracts/)
**Rama**: `feature/spec-4`

**Tests**: obligatorios (constitución VI). El dominio se escribe con TDD.

**Etiquetas**: `[P]` paralelizable · `[USn]` historia · **LOCAL** se hace y prueba ya ·
**BLOQUEADO(x)** espera la interfaz integrada del spec x · **COORD** requiere acordar con el equipo.

Rutas relativas a `proyecto/`; `carrito/` = `apps/api/src/modules/carrito/`.

## Phase 1: Setup

- [ ] T001 Crear `carrito/dominio/tipos.ts` con `Carrito`, `Linea`, `Vista`, `AvisoCarrito` y los límites configurables (`maxPorProducto` 20, `maxPorCarrito` 50, `diasInactividad` 30) según `data-model.md` (LOCAL).
- [ ] T002 Definir los puertos en `carrito/aplicacion/puertos.ts` (`CatalogoParaCarrito`, `PreciosParaCarrito`, `AlmacenCarritos`, `Reloj`) según `contracts/puertos.md`, sin importar código de otros módulos (LOCAL).

---

## Phase 2: Foundational

- [ ] T003 TDD de la caducidad en `carrito/dominio/carrito.ts` / `carrito.spec.ts`: carrito nuevo vacío; ≥ 30 días sin cambios → vacío; leer no renueva la actividad (LOCAL; R6, US2.3).

---

## Phase 3: User Story 1 — Armar el carrito (P1) 🎯 MVP

**Goal**: añadir, sumar, cambiar, quitar, deshacer y vaciar con límites.
**Independent Test**: añadir tres productos, cambiar una cantidad, quitar uno y deshacerlo; los totales se recalculan.

- [ ] T004 [US1] TDD de las operaciones en `carrito/dominio/carrito.spec.ts`: añadir (un producto repetido suma en vez de duplicarse), fijar cantidad (0 = quitar, negativa o decimal rechazada con mensaje), quitar, vaciar; tope 20 por producto y existencias con `ajuste {cantidad, motivo}`; tope 50 por carrito rechazado con explicación (LOCAL; FR-002, FR-008, casos límite).
- [ ] T005 [US1] TDD de deshacer en `carrito.spec.ts`: restaura la última eliminación en su posición, suma si el producto se volvió a añadir respetando los topes, deshace el vaciado; sin nada pendiente → error claro (LOCAL; R5, US1.5).
- [ ] T006 [US1] Implementar `carrito/aplicacion/carrito.service.ts`: casos de uso sobre `AlmacenCarritos` y la vista con precios, usando `PreciosParaCarrito` y `CatalogoParaCarrito` (validar que el producto está disponible al añadir); tests con dobles de los puertos (LOCAL; FR-004, FR-005, US1.4).
- [ ] T007 [US1] COORD → LOCAL: migración `infra/migrations/030_cart.sql` (bloque 030–039 de `infra/migrations/README.md`, hoy en `feature/spec-2`), solo aditiva.
- [ ] T008 [US1] `carrito/infraestructura/almacen-redis-postgres.ts`: *write-through* Postgres → Redis, lectura de Redis con caída a Postgres, versión optimista; integración con Redis y Postgres reales en `tests/integration/carrito-almacen.int.spec.ts` (LOCAL, Docker; dep. T007; R2, R3).
- [ ] T009 [US1] BLOQUEADO(2): endpoints de `contracts/carrito-http.md` con el `clienteId` de la sesión, detrás del flag `carrito-habilitado`; tests de autorización (sin sesión → 401; nunca el carrito de otro).
- [ ] T010 [US1] BLOQUEADO(3, 5): adaptadores `CatalogoParaCarrito` y `PreciosParaCarrito` a las interfaces integradas de Catálogo y Promociones, con pruebas de contrato.
- [ ] T011 [US1] BLOQUEADO(2) + aprobación visual: página `apps/web/src/app/carrito/` con `design-taste-frontend` + `frontend-design`; anuncios `aria-live="polite"` sin mover el foco; deshacer accesible por teclado; E2E Playwright + axe; revisión AAA manual (FR-009, SC-005).

---

## Phase 4: User Story 2 — Recuperar el carrito en otro momento o dispositivo (P1)

- [ ] T012 [US2] Integración: dos «dispositivos» (dos instancias del servicio) modifican el mismo carrito a la vez sin perder cambios; el segundo ve el estado más reciente (LOCAL, Docker; dep. T008; US2.1–2.2, SC-002).
- [ ] T013 [US2] Purga diaria de carritos caducados en el worker y TTL de 30 días en Redis; test de integración (LOCAL, Docker; dep. T008; R6).
- [ ] T014 [US2] BLOQUEADO(2): consumir `cliente.eliminado` y borrar el carrito de forma idempotente (LOPDP).

---

## Phase 5: User Story 3 — Enterarse de cambios antes de pagar (P2)

- [ ] T015 [US3] TDD de `carrito/dominio/avisos.ts` / `avisos.spec.ts`: `agotado`, `retirado`, `fuera_de_horario`, `existencias_insuficientes` (bloquean); `cambio_precio` con anterior y nuevo y `fin_promocion` (informativos); `confirmable`; tras mostrarse se actualiza la «vista» y el aviso informativo no se repite (LOCAL; R7, US3.1–3.3, FR-006, FR-007).
- [ ] T016 [US3] Integrar los avisos en la vista del servicio y en `CarritoApi.paraConfirmar` (LOCAL; dep. T006, T015).

---

## Phase 6: Interfaz para Pedidos y cierre

- [ ] T017 `CarritoApi` (`paraConfirmar`, `vaciarTrasPedido` idempotente por `pedidoId`) exportada desde `carrito/index.ts`, con tests (LOCAL; dep. T006, T016).
- [ ] T018 Añadir «contenido del carrito» al inventario de datos personales (finalidad: compra; retención: 30 días de inactividad) — COORD con quien mantiene el inventario (Spec 1/2).
- [ ] T019 Cobertura ≥ 80 % del módulo, lint, typecheck y ejecución de `quickstart.md` (LOCAL).

---

## Dependencies & Execution Order

- T001–T002 → T003 → US1 (T004–T006) → US3 (T015–T016) → T017.
- T007 → T008 → T012, T013 (Docker).
- Bloqueados: T009, T011, T014 (Identidad); T010 (Catálogo y Promociones).
- Pedidos (006) puede preparar pruebas con `contracts/carrito-api.md`, pero solo integra cuando este PR esté en `main`.

## Implementation Strategy

1. Dominio completo con TDD (T001–T006, T015–T016) y `CarritoApi` (T017): todo local.
2. Persistencia (T007–T008, T012–T013) con Redis y Postgres reales.
3. Al integrarse Identidad, Catálogo y Promociones: adaptadores, HTTP y página; el PR deja de ser borrador.
