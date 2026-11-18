# Alcance local por costo — decisión del Spec #1

**Estado:** aceptada por el líder del equipo (Nicolay) el 2026-11-18, pendiente de revisar con el resto del equipo y con el docente · **Revisores:** pendiente.

## Decisión

Todo el Spec #1 se desarrolla y verifica **en local con Docker**. **No se usan Vercel ni Render** (decisión del líder del 2026-11-18, que amplía la primera, que solo excluía Render): el frontend también se ejecuta en local (`pnpm dev` y `next start`). Se mantienen GitHub (Actions, rulesets, CodeQL) y SonarQube Cloud, gratuitos para un repositorio público.

## Motivo

Render exige plan de pago para parte de lo que el plan necesita (RabbitMQ privado con disco, workers, entornos de preview, según el ROADMAP; precios sin verificar). Vercel Hobby (uso no comercial) y GitHub (Actions, GHCR, protección de ramas y CodeQL en un repositorio público) no son el problema. Grafana Cloud Free retiene 14 días, menos que los 90 días de detalle y 12 meses de agregados que propone el plan; Grafana local con Docker no tiene ese límite. Fuentes y cifras en la conversación del 2026-11-18; confirmarlas en las páginas oficiales antes de contratar nada.

## Qué se hace igual, en local

Compose con Postgres, Redis, RabbitMQ y Mailpit; flags y migraciones; Dockerfiles de API y worker; un staging local que promueve imágenes por identificador y revierte (ensayo de la lógica, no de la nube); Grafana y SonarQube locales para validar paneles y umbrales.

## Qué queda «no evaluable» sin la nube (no se cierra como probado)

| Requisito | Por qué no se puede demostrar en local |
|---|---|
| FR-012: Vercel promueve el mismo paquete sin reconstruir | Es una propiedad de la plataforma Vercel, que no se usa |
| FR-009/FR-013, SC-004: preview por PR y staging en menos de 20 minutos | Dependen de Vercel y Render |
| SC-005/SC-006: rollback en menos de 5 minutos y sin interrupción | Dependen del plan y la capacidad de Render |
| FR-010/FR-011: secretos por entorno y permisos de la plataforma | Dependen de los paneles de Vercel y Render |
| T043–T049, T055, T060–T066, T075–T080 en su parte externa | Requieren A3/A4/A5/A6 |

`render.yaml` y los scripts de despliegue se **preparan** (PREP) pero no se ensayan. Esto no altera la constitución: Vercel y Render siguen siendo la plataforma objetivo, y cambiarla exigiría una enmienda aprobada por dos personas.

## Qué sí sigue siendo gratis y externo

Protección de `main`, ejecución real de los workflows, GHCR y CodeQL en GitHub, y SonarQube Cloud para repositorios públicos (confirmar al crear el proyecto). Requieren permisos de administrador del repositorio (A1) y un proyecto de Sonar (A2).

## Pendiente de preguntar al docente

Si el despliegue real en la nube es obligatorio para la entrega o basta un entorno local documentado y verificado.
