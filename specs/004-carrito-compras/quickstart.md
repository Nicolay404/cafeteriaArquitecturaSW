# Quickstart — Carrito de compras

Requisitos: los del [quickstart del Spec 1](../001-plataforma-entrega/quickstart.md). Comandos
desde `proyecto/`.

```powershell
# Dominio (TDD, sin Docker)
node --experimental-vm-modules node_modules/jest/bin/jest.js --config tests/unit/jest.config.ts apps/api/src/modules/carrito

# Persistencia Redis + Postgres reales (requiere Docker)
pnpm test:integration --runTestsByPath tests/integration/carrito-almacen.int.spec.ts

pnpm lint; pnpm typecheck
```

| Escenario del spec | Dónde se prueba |
|---|---|
| US1.1–1.3, 1.5 añadir, sumar, cambiar, quitar, deshacer | `dominio/carrito.spec.ts` |
| Casos límite de cantidad (0, negativa, máximos, existencias) | `dominio/carrito.spec.ts` |
| US1.4 precio original, descuento y final | `aplicacion/carrito.service.spec.ts` (con dobles de los puertos) |
| US2.1–2.2 mismo carrito entre dispositivos y concurrencia | `tests/integration/carrito-almacen.int.spec.ts` |
| US2.3 caducidad a los 30 días | `dominio/carrito.spec.ts` y la integración de la purga |
| US3.1–3.3 avisos y confirmable | `dominio/avisos.spec.ts` |
| US3.4, FR-009 anuncios sin mover el foco | E2E Playwright + axe (bloqueado por la UI y la sesión) |
