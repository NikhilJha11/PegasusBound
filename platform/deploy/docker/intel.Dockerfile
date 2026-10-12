# Pegasusbound Intelligence sidecar (experiments, learning, memory, MCP
# connections). Build context is the repository root (one level above
# platform/), because the engine lives in packages/engine.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/intel/package.json apps/intel/
RUN npm ci --workspace @iole/engine --workspace @iole/intel --include-workspace-root=false --no-audit --no-fund

# Start from the installed tree so workspace-local node_modules (npm nests
# packages there when versions differ) come along, then add the sources.
FROM deps
ENV NODE_ENV=production
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/engine ./packages/engine
COPY apps/intel ./apps/intel
RUN rm -rf packages/engine/test apps/intel/test && useradd --system --uid 10001 intel && chown -R intel /app
USER intel
WORKDIR /app/apps/intel
ENV MIGRATIONS_DIR=/app/packages/engine/drizzle PORT=8097
EXPOSE 8097
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:8097/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/index.ts"]
