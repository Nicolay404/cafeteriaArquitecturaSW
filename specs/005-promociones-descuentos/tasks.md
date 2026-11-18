---
description: "Tareas del spec 005 — Promociones y descuentos"
---

# Tasks: Promociones y descuentos

**Input**: `specs/005-promociones-descuentos/` (plan.md, spec.md, research.md, data-model.md, contracts/)
**Rama**: `feature/spec-5`

**Tests**: obligatorios (constitución VI). Todo el motor de precios se escribe con **TDD**: primero el
test que falla, luego la implementación. Cobertura objetivo del módulo ≥ 95 %.

**Etiquetas**: `[P]` paralelizable · `[USn]` historia · **LOCAL** se hace y prueba ya ·
**BLOQUEADO(x)** espera la interfaz integrada del spec x · **COORD** requiere acordar con el equipo
un archivo compartido.

Rutas relativas a `proyecto/`; `promociones/` = `apps/api/src/modules/promociones/`.

## Phase 1: Setup

- [x] T001 Crear `promociones/dominio/` con `dinero.ts` y su test `dinero.spec.ts`: centavos enteros seguros, puntos básicos 1–10000, `descuentoPorcentual(precio, pb)` con redondeo mitad hacia arriba (R3), rechazo de no enteros y negativos (LOCAL).

---

## Phase 2: Foundational

- [x] T002 Definir los tipos del contrato en `promociones/dominio/tipos.ts` (`LineaACotizar`, `SolicitudCotizacion`, `Cotizacion`, `PromocionAplicada`, `EstadoCupon`) según `contracts/promociones-api.md`, y los tipos de dominio `Promocion` según `data-model.md` (LOCAL).
- [x] T003 TDD de `promociones/dominio/vigencia.ts` en `vigencia.spec.ts`: ventana `[inicio, fin)` (justo antes, en el inicio, justo antes del fin, en el fin), conversión hora local `America/Guayaquil` ↔ UTC con `Intl` y zona configurable (LOCAL; R4).
- [x] T004 TDD de la validación de `Promocion` en `promociones/dominio/promocion.ts` / `promocion.spec.ts`: fin > inicio, alcance no vacío, nombre, valores por tipo, cupón, prioridad, monto mínimo; errores por campo con mensaje que indica cómo corregir (LOCAL; US1.4, FR-001/002/003/006/007).

**Checkpoint**: dominio base probado; el motor puede empezar.

---

## Phase 3: User Story 1 — Programar una promoción para una festividad (P1) 🎯 MVP

**Goal**: una promoción porcentual con ventana se aplica solo dentro de ella.
**Independent Test**: cotizar el mismo carrito antes, dentro y después de la ventana.

- [x] T005 [US1] TDD del motor en `promociones/dominio/motor-precios.spec.ts`: promoción porcentual por producto, categoría o menú; fuera de ventana, pausada o archivada no aplica; la cotización trae precio original, descuento, total y nombre de la promoción (US1.1–3, US1.5, US2.1) (LOCAL).
- [x] T006 [US1] Implementar `calcularCotizacion(solicitud, promociones, instante)` en `promociones/dominio/motor-precios.ts` para porcentaje, con ordenación por ID que garantiza determinismo (LOCAL; R1, R5).
- [ ] T007 [US1] COORD: acordar el número de migración y crear `infra/migrations/NNN_promotions_schema.sql` (esquema `promotions`, tablas de `data-model.md`, solo aditiva) (LOCAL tras acordar).
- [ ] T008 [US1] Repositorio `promociones/infraestructura/promociones.repository.ts` (guardar, versión optimista, listar candidatas `activa` con `fin > t`) con test de integración en `tests/integration/promociones.int.spec.ts` sobre Postgres real (LOCAL, requiere Docker; dep. T007).
- [x] T009 [US1] `promociones/aplicacion/cotizador.service.ts` que implementa `PromocionesApi.cotizar` (repositorio + motor + reloj inyectable) y lo exporta desde `promociones/index.ts`; test unitario con repositorio en memoria (LOCAL; dep. T006, T008). Hecho con fuente inyectable; la fuente real con Postgres llega con T008.
- [ ] T010 [US1] BLOQUEADO(2): endpoints `POST/PUT/GET /admin/promociones` y transiciones (`contracts/admin-http.md`) con guard de rol `admin` de Identidad, detrás del flag `promociones.admin`; tests de autorización (cliente y personal → 403).
- [ ] T011 [US1] BLOQUEADO(3): validar al guardar que los IDs del alcance existen, vía la interfaz pública de Catálogo.

**Checkpoint**: el motor aplica porcentajes por ventana y `cotizar` funciona con persistencia real.

---

## Phase 4: User Story 2 — Distintos tipos de descuento (P1)

**Goal**: monto fijo, N×M y combo con resultados exactos.
**Independent Test**: un carrito de prueba por tipo con el precio final calculado a mano.

- [x] T012 [P] [US2] TDD monto fijo por unidad, nunca negativo (US2.2) en `motor-precios.spec.ts` + implementación (LOCAL).
- [x] T013 [P] [US2] TDD N×M: 2x1 con 3 unidades paga 2 (US2.3), 3x2, mezcla de productos de una categoría (gratis los más baratos) + implementación (LOCAL; R5).
- [x] T014 [US2] TDD combo: pareja café + sánduche (US2.4), combo completado varias veces, combo incompleto no aplica, reparto proporcional exacto del descuento entre unidades + implementación (LOCAL; R5).

---

## Phase 5: User Story 3 — Combinar promociones de forma predecible (P2)

**Goal**: prioridad, acumulación y determinismo.
**Independent Test**: batería de carritos con promociones solapadas y precio esperado.

- [x] T015 [US3] TDD en `promociones/dominio/motor-combinacion.spec.ts`: dos no acumulables → mayor prioridad; igual prioridad → más favorable; empate total → menor ID; acumulable + no acumulable; varias acumulables sobre el precio restante; producto en varias categorías (US3.1–2) + ajustes del motor (LOCAL).
- [x] T016 [US3] Batería SC-002 en `motor-combinacion.spec.ts`: ≥ 20 casos tabulados con resultado a mano, y prueba de determinismo con las líneas y promociones permutadas y repetidas (US3.3) (LOCAL).

---

## Phase 6: User Story 4 — Cupones y condiciones (P3)

**Goal**: cupón, monto mínimo y límite de usos.
**Independent Test**: cupón con mínimo y límite, por debajo y por encima del mínimo y tras agotarse.

- [x] T017 [US4] TDD en el motor: promoción con cupón solo aplica con el código (normalizado), monto mínimo sobre subtotal bruto con `faltanteCentavos`, estados `aplicado`/`monto_minimo`/`agotado`/`no_vigente`/`no_valido`/`sin_efecto` (US4.1–3) (LOCAL; R6).
- [ ] T018 [US4] `registrarUsos`/`liberarUsos` en el repositorio: incremento atómico `usos < limite`, idempotente por `(promocion_id, pedido_id)`; test de integración con concurrencia (dos pedidos por el último uso → solo uno) (LOCAL, Docker; dep. T008).
- [ ] T019 [US4] Límite de intentos fallidos de cupón en Redis (`promociones/aplicacion/cupones.service.ts`), por IP de momento; test de integración con Redis real (US4.4, FR-012) (LOCAL, Docker). Sujeto por cliente: BLOQUEADO(2).

---

## Phase 7: Polish & transversal

- [ ] T020 Auditoría: insertar en `promotions.promotion_changes` en cada cambio, con test de integración (FR-014) (LOCAL; dep. T008).
- [ ] T021 Caché de vigentes en Redis con invalidación y TTL 60 s (`promociones/infraestructura/cache-vigentes.ts`), test de integración (R8) (LOCAL, Docker).
- [ ] T022 BLOQUEADO(2): `POST /admin/promociones/simular` (FR-013) sobre `cotizar` con `instante` futuro.
- [ ] T023 BLOQUEADO(2): pantallas de administración (listar, crear, editar, simular) con `design-taste-frontend` + `frontend-design`, Playwright + axe, revisión AAA manual; requiere aprobación visual del equipo (SC-003).
- [ ] T024 Medir el motor con 50 unidades y 200 promociones (< 5 ms) y registrar el resultado en `specs/005-promociones-descuentos/evidence/rendimiento.md` (LOCAL). La prueba k6 de SC-005 se suma a la del Spec 1.
- [ ] T025 Verificar cobertura ≥ 95 % del módulo, lint, typecheck y la ejecución de `quickstart.md` (LOCAL).

---

## Dependencies & Execution Order

- Setup (T001) → Foundational (T002–T004) → US1 (T005–T009) → US2 y US3 → US4 → Polish.
- US2 (T012–T014) y US3 (T015–T016) dependen del motor de T006; T012 y T013 son paralelizables.
- T008, T018–T021 necesitan Docker (Testcontainers).
- Bloqueados: T010, T022, T023 (Identidad); T011 (Catálogo); sujeto por cliente de T019 (Identidad).
- Consumidores: Carrito (004) y Pedidos (006) pueden preparar sus pruebas de contrato con `contracts/promociones-api.md`, pero solo integran cuando este PR esté en `main`.

## Parallel Example

```text
Tras T006: T012 (monto fijo) y T013 (N×M) en paralelo; T007 (migración) en paralelo al motor.
```

## Implementation Strategy

1. MVP: T001–T009 → `cotizar` con porcentajes y ventanas, persistido. Primer PR en borrador.
2. Tipos (US2) y combinación (US3): el motor completo y la batería SC-002.
3. Cupones (US4), auditoría y caché.
4. Cuando Identidad y Catálogo integren sus interfaces: T010, T011, T022, T023, y el PR deja de ser borrador.
