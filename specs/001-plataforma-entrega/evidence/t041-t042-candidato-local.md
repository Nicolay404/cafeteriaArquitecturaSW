# T041–T042 — candidato, entorno e imágenes, verificados en local

2026-11-18, Windows 11, Docker Desktop Linux 29.8.0. Sin nube: no hay `vercel.json` ni Blueprint de Render (ver [alcance-local.md](../decisions/alcance-local.md)). Lo que se promueve entre entornos locales son las imágenes por digest y un manifiesto.

## T041 — contratos y configuración de runtime

- `packages/contracts/src/candidate.ts`, `environment.ts` y `secrets.ts`. El **candidato** es inmutable (objetos congelados), se identifica por su contenido (`cand-` más 12 hex del SHA-256 de su contenido canónico) y exige SHA completo, digests `sha256:<64 hex>` (un tag como `latest` se rechaza con un error que lo explica), checksums de migraciones, una revisión de configuración sin secretos y referencias de informe `https` sin credenciales. Un `id` que no corresponde al contenido, un campo desconocido o un valor que parece un secreto se rechazan. El **entorno** acepta `preview`, `staging` o `production`, exige el número de PR solo en el preview, y la configuración solo admite **referencias** (`ref:`, `secret:`) o `publico:valor`, nunca un secreto en claro.
- `tests/unit/candidate.spec.ts`: 35 casos. Mutación: 5 mutaciones; 4 detectadas y la quinta (no comprobar el `id`) reveló que faltaba una prueba, que se añadió.
- **FR-012 en local** (`tests/integration/deployment-config.int.spec.ts`, 2/2): la web se compila **una vez**, se ejecuta con dos APIs distintas y cada ejecución responde con la versión de la suya (la configuración es de runtime), mientras que el hash de lo compilado y cada archivo siguen idénticos. Además la compilación no contiene ningún origen de API ni URL de entorno. **No prueba a Vercel**: demuestra que el paquete no lleva la URL compilada.
- Hallazgo: Next escribe `.next/server/route-cache/` la primera vez que se sirve una página (además de `.next/cache`). Es una caché de ejecución, no parte del paquete; se excluye por nombre y de forma explícita (`WEB_RUNTIME_CACHE`). La prueba muestra archivo por archivo qué cambió, para no esconder nada.
- Hallazgo del arnés: en Windows `kill()` solo mata al padre de `next start` y deja un proceso huérfano que mantenía abierto el puerto; la prueba mata el árbol de procesos y comprueba que no quedan huérfanos ni puertos ocupados.

## T042 — imágenes y manifiesto

- `apps/api/Dockerfile`, `apps/worker/Dockerfile` y `apps/web/Dockerfile`: multi-etapa, base `node:24.22.1-bookworm-slim` **fijada por digest**, instalación congelada y sin scripts (ni el hook de Husky), solo dependencias de producción en la imagen final (`pnpm deploy --prod`), usuario `node` sin privilegios. La API y la web tienen `HEALTHCHECK`; el worker no tiene puerto.
- Tamaños: API 375 MB, worker 374 MB, web 892 MB (Next y sus binarios nativos).
- **Verificación real** con Compose arriba (los tres contenedores juntos): `/health` de la API 200 con Postgres, Redis y RabbitMQ reales; Docker marca la API y la web como `healthy`; la web alcanza a la API por su configuración de runtime (`/api/health` 200 con la versión de la API); el worker deja su señal en Redis y la **borra al apagarse limpio con código de salida 0**; los tres procesos corren como `node`.
- Defecto encontrado y corregido: el `.dockerignore` usaba `node_modules/` (solo la raíz), así que `COPY apps/api` metía los `node_modules` del equipo del desarrollador (enlaces simbólicos rotos) sobre los instalados y `tsc` fallaba con «Cannot find module '@nestjs/common'». Ahora usa `**/node_modules` y equivalentes.
- `scripts/ci/package-candidate.ts`: construye las tres imágenes desde un **`git worktree` limpio del SHA indicado** (nunca desde el árbol de trabajo), toma el digest de cada imagen, calcula el hash de la web a partir de la compilación **extraída de la imagen** (sin cachés) y los checksums de las migraciones, y escribe el manifiesto en `proyecto/candidates/` (ignorado por Git). El CLI solo acepta `--sha`: **no hay ruta de salida por argumento** (lección del path traversal de Sonar). 12 pruebas con Docker simulado más una ejecución real.

## Ejecución real

| Commit | Candidato | Web (hash) | API | Worker |
|---|---|---|---|---|
| `22e0c3c` | `cand-691d523fb121` | `sha256:e58af2ab…` | `sha256:73e8dfae…` | `sha256:cfb1199a…` |
| `1b3be7f` (solo cambia un script) | `cand-fcb989313406` | **`sha256:e58af2ab…`** | `sha256:9a48c788…` | `sha256:48c796df…` |

- **La compilación de la web es reproducible:** dos construcciones independientes dieron el mismo hash.
- **Las imágenes de la API y del worker NO son idénticas bit a bit** entre construcciones aunque su código no cambie (cambian las fechas de los archivos del checkout y la atestación de BuildKit). Por eso **no se afirma reproducibilidad de las imágenes**: la promoción debe reutilizar *las mismas imágenes por digest*, nunca reconstruirlas, y el id del candidato cambia con cada construcción. Es coherente con FR-012, pero conviene no presentarlo como «build reproducible».
- Cambiar el SHA, rebasear o reconstruir `main` produce un candidato nuevo (el id depende del contenido), que tendría que pasar los controles de nuevo.

## Límites

- Todo local: el digest de una imagen es el identificador de la imagen local (lista de manifiestos de BuildKit), no el de un registro. Publicar en GHCR y verificar el digest remoto necesita un `packages: write` que aún no se ha probado.
- `vercel.json` y el Blueprint de Render no se crean: no se usan esas plataformas.
- La web de 892 MB es pesada; reducirla (salida `standalone` de Next) es una optimización pendiente que no se hizo para no cambiar la configuración de la web sin necesidad.
