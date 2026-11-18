# Quickstart — Promociones y descuentos

Requisitos: los del [quickstart del Spec 1](../001-plataforma-entrega/quickstart.md) (Node 24.22.1,
pnpm por Corepack; Docker solo para integración). Comandos desde `proyecto/`.

```powershell
pnpm install --frozen-lockfile

# Motor y dominio (TDD, sin Docker)
node --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/unit/jest.config.ts apps/api/src/modules/promociones

# Todos los unitarios con cobertura
pnpm test:unit

# Persistencia y caché con Postgres/Redis reales (requiere Docker)
pnpm test:integration --runTestsByPath tests/integration/promociones.int.spec.ts

pnpm lint; pnpm typecheck
```

## Escenarios de verificación

| Escenario del spec | Dónde se prueba |
|---|---|
| US1.1–3 ventana `[inicio, fin)` | `dominio/vigencia.spec.ts`, `dominio/motor-precios.spec.ts` |
| US1.4 validación al crear | `dominio/promocion.spec.ts` |
| US2.1–4 tipos | `dominio/motor-precios.spec.ts` |
| US3.1–3 combinación y determinismo (SC-002) | `dominio/motor-combinacion.spec.ts` |
| US4.1–3 cupones | `dominio/motor-precios.spec.ts`, `aplicacion/cupones.service.spec.ts` |
| US4.4 límite de intentos | `tests/integration/promociones.int.spec.ts` (Redis real) |
| FR-013 simulación | `aplicacion/cotizador.service.spec.ts` |

La batería de combinaciones (SC-002) es una tabla de casos con el precio esperado calculado a mano;
cualquier cambio del algoritmo que altere un caso debe justificarse en `research.md` (R5).
