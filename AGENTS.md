# Instrucciones compartidas — Proyecto Cafetería

Lee `.specify/memory/constitution.md` antes de planificar o implementar. La constitución prevalece. Consulta `promtp.md` para los requisitos y la arquitectura del producto, y `ROADMAP.md` para la fase correspondiente.

Trabaja únicamente en la rama `feature/spec-X` asignada por el equipo. Verifica la rama y la ruta del spec antes de editar. No crees ni cambies de rama automáticamente. No hagas commits, push ni abras un Pull Request sin autorización. Los PR del equipo apuntan a `main` de `Nicolay404/cafeteriaArquitecturaSW`, no al repositorio original.

La documentación compartida vive en `specs/`. Reutiliza el `spec.md` existente y guarda `plan.md` y `tasks.md` en la misma carpeta. No dupliques especificaciones ni dejes decisiones importantes solo en el chat de un agente. Para `feature/spec-1`, usa `specs/001-plataforma-entrega/spec.md`.

Cada spec usa una única rama con el nombre exacto `feature/spec-X` (sin sufijos). Los comandos de Spec Kit (`/speckit-specify` y su hook de Git) pueden proponer crear una rama con otro nombre: no la crees; trabaja en la rama asignada y usa la carpeta del spec existente.

**Frontend:** para cualquier cambio de interfaz, invoca siempre la skill `design-taste-frontend` (`.claude/skills/design-taste-frontend/SKILL.md`, instalada con taste-skill) y apóyate también en `frontend-design`. Úsalas como guía de jerarquía, composición y consistencia, sin generar imágenes, logos ni mockups con IA y sin inventar datos del negocio. Verifica por separado los requisitos de la constitución: WCAG AAA (contraste ≥ 7:1, teclado, foco visible, objetivos ≥ 44×44 px, movimiento reducible). La dirección visual, las fotos y los textos finales requieren la aprobación del equipo antes de implementarse.

**Alcance actual (decisión del equipo, ver `specs/001-plataforma-entrega/decisions/alcance-local.md`):** todo se desarrolla y verifica en local con Docker. No contrates ni crees cuentas de pago (Render) y no despliegues; lo que dependa de la nube se marca como no evaluable, con el motivo.