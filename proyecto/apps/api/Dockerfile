# API de la cafetería. Contexto de construcción: proyecto/ (docker build -f apps/api/Dockerfile .).
# Imagen base fijada por digest, nunca por un tag mutable (constitución y FR-012).
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
RUN corepack enable

# Primero solo los manifiestos y el lockfile: la capa de dependencias se reutiliza mientras no cambien.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
# --ignore-scripts: ni el hook de Husky del workspace ni scripts de dependencias dentro de la imagen.
# Esta etapa se descarta: se instala todo el workspace porque la compilación necesita las
# herramientas de desarrollo de la raíz (TypeScript, tipos de Node). La imagen final solo lleva producción.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @cafeteria/api build \
 && pnpm --filter @cafeteria/api --prod deploy /out

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Solo dependencias de producción y el código compilado; sin fuentes, pruebas ni herramientas.
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 3001
# Liveness: el proceso responde sin exigir servicios externos (contracts/platform.md).
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/apps/api/src/main.js"]
