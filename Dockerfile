# syntax=docker/dockerfile:1
FROM oven/bun:1.4.2 AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig*.json biome.json commitlint.config.cjs ./
RUN bun install --frozen-lockfile --production=false

FROM deps AS build
RUN bun run --filter @opensaas/core build 2>/dev/null || true
RUN bun run --filter @opensaas/database build 2>/dev/null || true
RUN bun run --filter @opensaas/auth build 2>/dev/null || true
RUN bun run --filter @opensaas/api build 2>/dev/null || true

FROM base AS runtime
RUN addgroup --system --gid 1001 bunjs && \
    adduser --system --uid 1001 bunjs
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/bun.lock ./bun.lock
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/tsconfig*.json ./
USER bunjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["bun", "run", "--filter", "@opensaas/api", "start"]
