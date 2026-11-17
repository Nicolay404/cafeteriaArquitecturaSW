# Modelo de información — Plataforma de entrega

Diseño lógico, no migraciones implementadas. No crea entidades Cliente, Menú, Producto, Pedido o Pago. GitHub, Actions y Sonar son fuentes de verdad; telemetría almacena únicamente lo necesario para correlación/recuperación. Fechas UTC; duraciones enteras no negativas. Identificadores de autor/aprobador son datos personales sujetos al inventario de `plan.md`.

| Entidad | Campos mínimos / validación | Relaciones |
|---|---|---|
| PropuestaCambio | repo permitido, número positivo, base/head SHA, authorId, reviewerIds, estado, previewURL HTTPS opcional | 1:N Commit y Ejecución |
| Commit | SHA completo, tipo/alcance/descripción Conventional Commits, parentSHA, fecha, authorId | Pertenece a propuesta; puede originar candidato |
| Ejecución | providerRunId, attempt positivo, SHA, job, inicio/fin, resultado, causa opcional | N:1 Commit; 0:N ResultadoCalidad/Despliegue |
| ResultadoCalidad | analysisId, SHA, cobertura nueva 0–100, bugs/vulnerabilidades enteros ≥0, hotspots revisados 0–100, duplicación 0–100, ratings, gate | N:1 candidato; snapshot verificable, ausencia no significa aprobado |
| Candidato | candidateId, SHA, digestAPI/digestWorker, hashWeb, migrationChecksums, configRevision, reportRefs | Inmutable; 1:N Despliegue; sin secretos dentro |
| Despliegue | id, candidateId, entorno, start/end, previousDeploymentId, resultado, approverId solo producción | N:1 Entorno/Candidato; vínculo al despliegue restaurado |
| Entorno | tipo preview/staging/production, PR si preview, URL pública, región, referencias de configuración/secretos | Configuración no contiene valores secretos |
| EventoEntrega | source, externalId, attempt, tipo, occurredAt, deploymentId opcional, payload mínimo, deliveredAt, retryCount | Clave única source+externalId+attempt+tipo; persistir antes de envío |
| CursorFuente | source, lastCursor, watermark, updatedAt | Avanza tras persistir lote; solapamiento deduplicado |
| MétricaEquipo | nombre, ventana, valor/unidad, entorno, fuente, equipo y subjectId solo donde autorizado | Derivada de eventos; no inventar cero cuando faltan muestras |
| FlagTécnico | clave permitida, booleano, revision, changedAt | Redis, lectura runtime y false seguro ante fallo |

Estados de despliegue: preparado → esperando_aprobación (solo producción) → migrando → backend_listo → frontend_listo → verificando → correcto. Fallo previo a activación conserva versión anterior; fallo de smoke → revirtiendo → revertido o fallo_de_restauración con alerta. Nunca marcar correcto antes de smoke. Sin migración de datos destructiva durante rollback.

Estados de propuesta/ejecución/calidad provienen del proveedor; registrar fallo intermitente original aunque un reintento pase. Producción no admite dos despliegues simultáneos. Un candidato distinto exige controles propios. No duplicar entidades completas de GitHub en base de negocio.

Ensayo local de migración: tabla técnica de prueba, datos sintéticos y checksum; expandir con campo opcional compatible, ejecutar N/N−1, simular fallo antes de activación y compensar con nueva migración preservando filas. No es modelo de catálogo ni de clientes.

Datos de actividad: finalidad mejora/visibilidad; detalle 90 días/agregado equipo 12 meses como propuesta pendiente. Sin recopilar antes de aprobación/información al equipo. Restringir tanto datasource como dashboard individual. Inventario y revisiones en Markdown versionado; sin secretos ni payloads personales innecesarios.
