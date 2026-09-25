# Dockerfile for Agentic Harness runtime
# Multi-stage build running directly on Bun to support dynamic imports and plugins

# -----------------------------------------------------------------------------
# Builder Stage: installs monorepo dependencies and builds workspaces
# -----------------------------------------------------------------------------
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json bun.lock ./
COPY packages/core/package.json ./packages/core/
COPY apps/agentic-harness/package.json ./apps/agentic-harness/

# Install workspace dependencies
RUN bun install --frozen-lockfile || bun install

# Copy source code
COPY packages/core ./packages/core
COPY apps/agentic-harness ./apps/agentic-harness

# Build workspace packages
RUN bun run --filter @byo-ai-agent-platform/core build && \
    bun run --filter @byo-ai-agent-platform/agentic-harness build && \
    chmod -R a+rX /app

# -----------------------------------------------------------------------------
# Target: Distroless (minimal, ca-certificates, non-root security)
# -----------------------------------------------------------------------------
FROM oven/bun:1-distroless AS distroless

COPY --from=builder /app /app

USER 65532:65532
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/src/index.ts"]


