# Implementation Plan: Promociones y descuentos

**Branch**: `feature/spec-5` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/005-promociones-descuentos/spec.md`

## Summary

RF-06: el administrador programa promociones (porcentaje, monto fijo, N×M, combo) con alcance por
producto, categoría o menú, ventana de vigencia, condiciones (monto mínimo, cupón, límite de usos)
y reglas de combinación (prioridad, acumulable). El precio final lo calcula siempre el servidor.

Enfoque: el corazón es un **motor de precios puro y determinista** dentro del módulo `promociones`
(sin E/S, sin reloj implícito, aritmética entera en centavos). Recibe las líneas que ya resolvió
quien llama (Carrito o Pedidos, con los datos públicos de Catálogo) y las promociones candidatas, y
devuelve una cotización con el descuento por línea y las promociones aplicadas. Alrededor del motor:
repositorio propio en el esquema `promotions`, servicio público `PromocionesApi.cotizar()` que
consumirán los specs 004 y 006, y la administración (CRUD, simulación, auditoría) detrás de la
autorización de Identidad.

La vigencia se evalúa en cada cálculo con el instante de servidor (`inicio ≤ t < fin`), así que la
activación y desactivación «automáticas» (FR-005) no necesitan un cron: la precisión es exacta, no
de 1 minuto. La caché de promociones vigentes (Redis) se invalida al cambiar una promoción y nunca
amplía una ventana.

## Dependencias con otros specs

| Necesita | De | Para qué | Estado (2026-11-18) |
|---|---|---|---|
| Base del monorepo, límites de módulos, migraciones, Testcontainers | Spec 1 | Todo | Integrado en `origin/main` |
| Guard de sesión + rol `admin` (con MFA) | Spec 2 Identidad | Endpoints de administración (FR-001, FR-013) | **Bloqueado**: solo `spec.md`, sin interfaz publicada |
| Identificador del sujeto (cliente) para limitar intentos de cupón | Spec 2 Identidad | FR-012 por cliente | **Bloqueado**; se puede limitar por IP mientras tanto |
| Comprobar que los IDs de producto, categoría o menú del alcance existen | Spec 3 Catálogo | Validación al guardar (US1.4) | **Bloqueado**: Catálogo no publica interfaz |
| Pertenencia producto → categorías y menú, precio base vigente | Spec 3 Catálogo | Entrada del motor | No lo lee Promociones: lo pasa quien llama (decisión R2) |
| Registro de auditoría central | Spec 8 | FR-014 | Se registra en una tabla propia inmutable; Reportes la leerá por interfaz |

Lo que **no** depende de nadie: el motor (US1 ventanas, US2 tipos, US3 combinación, US4 condiciones),
la validación de dominio, el esquema `promotions`, el repositorio y el contrato `PromocionesApi`.
Esa parte se implementa primero. Los endpoints y la UI de administración quedan preparados en
`tasks.md` y marcados **BLOQUEADO** hasta que Identidad y Catálogo integren sus interfaces.

## Technical Context

**Language/Version**: TypeScript 5.9.3 en Node 24.22.1 (ESM)
**Primary Dependencies**: NestJS 12.5.1 (módulo `PromocionesModule`), `pg` 8.23.1, `redis` 6.3.1. Sin dependencias nuevas.
**Storage**: PostgreSQL, esquema propio `promotions`; caché de promociones vigentes en Redis (Key Value).
**Testing**: Jest + ts-jest para `apps/api/src/**` (unitarios, TDD), Testcontainers (Postgres/Redis reales) en `tests/integration`, Playwright + axe para la UI de administración (cuando se desbloquee).
**Target Platform**: API NestJS en Render (local con Docker, ver `alcance-local.md`).
**Project Type**: monolito modular web (API + Next.js).
**Performance Goals**: cotizar un carrito < 300 ms p95 (SC-005); el motor en sí < 5 ms para 50 unidades.
**Constraints**: aritmética entera (centavos y puntos básicos); determinismo total; precio final ≥ 0; zona horaria `America/Guayaquil`; precisión de ventana ≤ 1 min (se obtiene exacta).
**Scale/Scope**: decenas a cientos de promociones activas; carritos ≤ 50 unidades (límite del spec 004).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Accesibilidad AAA:** la UI de administración (T040+) y la visualización de ahorro se verificarán con axe y lector de pantalla; esta fase no crea UI.
- [x] **II. Seguridad:** endpoints de administración solo con rol `admin` comprobado en el servidor (guard de Identidad); entradas validadas en el dominio; cupones con límite de intentos (FR-012); el cliente nunca envía precios: el motor recibe precios desde el servidor.
- [x] **III. LOPDP:** Promociones no guarda PII. El uso de cupones se registra por `pedidoId`, no por persona. La auditoría guarda el ID del administrador (identificador, no PII).
- [x] **IV. Escalabilidad y consistencia:** motor puro y sin estado; promociones vigentes en caché Redis; el contador de usos se incrementa de forma atómica e idempotente por `pedidoId`; precio siempre en el servidor y copia inmutable en el pedido (spec 006).
- [x] **V. Límites de dominio:** solo esquema `promotions`; Catálogo e Identidad solo por su `index.ts` público; Carrito y Pedidos consumen `PromocionesApi` desde `modules/promociones/index.ts`. Sin dependencias nuevas.
- [x] **VI. Calidad:** TDD obligatorio en el motor; cobertura objetivo ≥ 95 % del módulo; batería de combinaciones (SC-002); integración con Postgres/Redis reales.
- [x] **VII. Reversibilidad:** migración solo aditiva (expand); endpoints nuevos detrás del flag `promociones.admin`; commits por bloque de `tasks.md`.
- [x] **Plataforma:** TypeScript, sin Python; nada de despliegue (alcance local).

Re-evaluación post-diseño: sin violaciones. No hay tabla de complejidad.

## Project Structure

### Documentation (this feature)

```text
specs/005-promociones-descuentos/
├── plan.md              # este archivo
├── research.md          # decisiones R1–R9
├── data-model.md        # entidades, validaciones y esquema promotions
├── quickstart.md        # cómo probar el módulo en local
├── contracts/
│   ├── promociones-api.md   # interfaz pública para Carrito (004) y Pedidos (006)
│   └── admin-http.md        # endpoints de administración (bloqueados por Identidad)
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
proyecto/
├── apps/api/src/modules/promociones/
│   ├── index.ts                     # API pública: PromocionesModule, PromocionesApi y tipos de contrato
│   ├── promociones.module.ts
│   ├── dominio/
│   │   ├── dinero.ts                # centavos, puntos básicos, redondeo único (R3)
│   │   ├── promocion.ts             # tipos de dominio y validación (FR-001..FR-007)
│   │   ├── vigencia.ts              # ventana [inicio, fin) y hora local (R4)
│   │   ├── motor-precios.ts         # cálculo determinista (R5)
│   │   └── *.spec.ts                # TDD junto al código (Jest)
│   ├── aplicacion/
│   │   ├── cotizador.service.ts     # PromocionesApi.cotizar: carga candidatas + motor
│   │   └── cupones.service.ts       # validación de cupón, usos, límite de intentos
│   └── infraestructura/
│       ├── promociones.repository.ts  # SQL sobre esquema promotions
│       └── cache-vigentes.ts          # Redis
├── infra/migrations/NNN_promotions_schema.sql
└── tests/integration/promociones.int.spec.ts
```

**Structure Decision**: todo vive dentro de `apps/api/src/modules/promociones`, respetando los
límites existentes (`eslint-plugin-boundaries`). Los tests unitarios van junto al código porque la
configuración Jest de API ya los recoge (`apps/api/src/**/*.spec.ts`). El número de la migración se
coordina con el equipo antes de crearla (la carpeta `infra/migrations` es compartida).

**Archivos compartidos**: no se editan `CLAUDE.md` (actualización de contexto del agente),
`.specify/feature.json`, workflows, Docker ni el registro de módulos sin coordinar. Para Spec Kit se
usa `SPECIFY_FEATURE_DIRECTORY=specs/005-promociones-descuentos`.

## Complexity Tracking

Sin violaciones.
