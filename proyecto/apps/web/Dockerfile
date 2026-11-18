# Web (Next.js) de la cafetería. Contexto de construcción: proyecto/
# (docker build -f apps/web/Dockerfile .). Imagen base fijada por digest.
# La URL de la API NO se compila: se lee en runtime (API_BASE_URL), así que la misma imagen sirve
# para cualquier entorno (FR-012).
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
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
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json ./
COPY packages packages
COPY apps/web apps/web
RUN NODE_ENV=production pnpm --filter @cafeteria/web build \
 && pnpm --filter @cafeteria/web --prod deploy /out

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 WEB_PORT=3000
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/web/.next ./.next
# Next escribe sus cachés de ejecución en .next: el usuario sin privilegios debe poder hacerlo.
RUN chown -R node:node /app/.next
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.WEB_PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["sh", "-c", "exec node_modules/.bin/next start -p \"${WEB_PORT}\" -H 0.0.0.0"]
