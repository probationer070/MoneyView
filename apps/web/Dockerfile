# MoneyView Web (Next.js) — D10 pipeline image.
# Build context: REPO ROOT (the app imports ../../packages/shared-types).
#   docker build -f apps/web/Dockerfile .
# NEXT_PUBLIC_API_BASE_URL is baked into the CLIENT bundle at build time (browser
# calls). The SERVER (SSR) reads the same variable from the runtime environment,
# which the k8s deployment sets to the in-cluster service address.

FROM node:22-alpine AS deps
WORKDIR /repo/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /repo
COPY packages/shared-types/ ./packages/shared-types/
COPY apps/web/ ./apps/web/
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
WORKDIR /repo/apps/web
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:9080
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
# standalone is rooted at the repo (outputFileTracingRoot), so server.js lives
# under apps/web/ inside it; static and public sit next to it.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["node", "-e", "fetch('http://localhost:3000/api/runtime/backend-port').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
