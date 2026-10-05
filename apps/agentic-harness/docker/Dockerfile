# Dockerfile for Agentic Harness runtime
# Multi-stage build running pre-bundled index.js on Bun

# -----------------------------------------------------------------------------
# Builder Stage: installs monorepo dependencies and copies pre-built dist
# -----------------------------------------------------------------------------
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY apps/agentic-harness/package.json ./apps/agentic-harness/

# Install workspace dependencies
RUN bun install --frozen-lockfile || bun install

# Copy pre-built bundle
COPY apps/agentic-harness/dist /app/apps/agentic-harness/dist

RUN chmod -R a+rX /app
RUN mkdir -p /workspace && chown -R 65532:65532 /workspace && chmod 777 /workspace

# -----------------------------------------------------------------------------
# Target: Distroless (minimal, ca-certificates, non-root security)
# -----------------------------------------------------------------------------
FROM oven/bun:1-distroless AS distroless

COPY --from=builder /app /app
COPY --from=builder --chown=65532:65532 /workspace /workspace

ENV NODE_PATH="/workspace/node_modules:/app/node_modules"

USER 65532:65532
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/dist/index.js"]
