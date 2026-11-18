# Worker técnico de la cafetería. Contexto de construcción: proyecto/
# (docker build -f apps/worker/Dockerfile .). Imagen base fijada por digest.
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /repo
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
# --ignore-scripts: ni el hook de Husky del workspace ni scripts de dependencias dentro de la imagen.
# Esta etapa se descarta: se instala todo el workspace porque la compilación necesita las
# herramientas de desarrollo de la raíz. La imagen final solo lleva producción.
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY packages packages
COPY apps/worker apps/worker
RUN pnpm --filter @cafeteria/worker build \
 && pnpm --filter @cafeteria/worker --prod deploy /out

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
USER node
# Sin puerto público ni healthcheck HTTP: su actividad se verifica con la señal privada en Redis.
CMD ["node", "dist/apps/worker/src/main.js"]
