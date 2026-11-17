# Investigación y decisiones — Spec #1

Fecha: 2026-11-16. Investigación documental, no experimentación del stack. Revisión cruzada de solo lectura contrastó spec, constitución, requisitos y roadmap. Las alternativas no cambian tecnologías constitucionales.

| Decisión propuesta | Razón | Alternativas consideradas |
|---|---|---|
| pnpm/Turborepo, Next/Nest/worker TypeScript | Fase 0 y stack constitucional; contratos compartidos y builds por paquete | Apps aisladas duplican configuración; microservicios requieren ADR/métricas |
| Servicios reales en Compose y Testcontainers | Reproducibilidad y principio VI; pruebas no dependen de cuentas | Mocks solos no verifican persistencia/mensajería |
| Solo inicio y salud como demostración | SC-009; CU003 sirve para límites futuros | Construir catálogo/login ampliaría spec |
| Catálogo agrupa menú/producto; Promociones conserva reglas | Constitución prevalece sobre paquetes del draw.io | Módulos MENU/PRODUCTO/ADMIN propietarios cruzados rompen límites |
| Jest backend/integración, Vitest componentes, Playwright/axe E2E | Herramientas con responsabilidades separadas | Duplicar suites entre runners añade coste |
| SQL técnico mínimo sin ORM de negocio | Ensayar conectividad/migración sin anticipar modelos | Elegir ORM/tablas completas carece de alcance |
| RabbitMQ privado Render | Restricción constitucional de red | CloudAMQP necesita revisar conectividad y eventual enmienda |
| SonarQube Cloud/Grafana Cloud como propuesta | Supuestos del spec; menor operación del equipo pequeño | Autohospedar requiere decisión/capacidad; no se cambia sin registrar ADR |
| Manifiesto por candidato y promoción inmutable | FR-012, trazabilidad y rollback | Tags mutables/rebuild de release no garantizan mismo artefacto |
| Flags Redis runtime y telemetría durable | Sin estado local; flags sin redeploy y recuperación de métricas | Env compilada o disco efímero incumplen comportamiento requerido |
| Boceto humano; Taste como checklist | Instrucción explícita de autoría y constitución AAA | Generadores y decisiones aleatorias no sustituyen aprobación |

## Verificaciones documentales de proveedores

Consultadas el 2026-11-16; no demuestran prestaciones del plan contratado:

- [Render: imágenes preconstruidas](https://render.com/docs/deploying-an-image): permite identidad por digest y tareas previas. Se planifica manifiesto/ensayo de migración fallida.
- [Render: rollbacks](https://render.com/docs/rollbacks): tag puede resolver una imagen distinta; retención limita recuperación. Se conserva digest e imagen previa y se mide restauración.
- [Vercel: promoción](https://vercel.com/docs/deployments/promoting-a-deployment) y [CLI deploy](https://vercel.com/docs/cli/deploy): promoción/configuración por entorno y prebuilt requieren comprobación conjunta. No inferir que un cambio de variables conserva automáticamente identidad/aislamiento.

## Resolución de incógnitas y puertas

No quedan decisiones de negocio que deban inventarse para planificar plataforma. Las condiciones pendientes están asignadas a puertas en `plan.md` §4–6: versiones exactas/compatibilidad se fijan y prueban antes de aceptar bootstrap; FR-012 Vercel exige ensayo externo antes de aceptar promoción; acceso cloud antes de declarar despliegue; diseño humano antes de UI; privacidad antes de recopilar. No son funcionalidades verificadas ni excepciones aprobadas.

Las diferencias de actores, Oferta, CAPTCHA y metadato de rama permanecen explícitas para revisión del equipo, sin bloquear el diseño de salud/entrega ni autorizar implementación de esos dominios. Constitution Check documental antes/después está en `plan.md`; no sustituye aprobación de gates reales.
