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
# Target 1: Distroless (Recommended: minimal, ca-certificates, non-root security)
# -----------------------------------------------------------------------------
FROM oven/bun:1-distroless AS distroless

COPY --from=builder /app /app

USER 65532:65532
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/src/index.ts"]

# -----------------------------------------------------------------------------
# Target 2: Debian (bookworm-slim)
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS debian

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /workspace && \
    chown -R harness:harness /workspace

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder /app /app

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/src/index.ts"]

# -----------------------------------------------------------------------------
# Target 3: RedHat (UBI 9 Minimal)
# -----------------------------------------------------------------------------
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest AS redhat

RUN microdnf install -y ca-certificates && \
    microdnf clean all && \
    groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /workspace && \
    chown -R harness:harness /workspace

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder /app /app

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/src/index.ts"]

# -----------------------------------------------------------------------------
# Target 4: RedHat (UBI 10 Minimal)
# -----------------------------------------------------------------------------
FROM registry.access.redhat.com/ubi10/ubi-minimal:latest AS ubi10-minimal

RUN (microdnf install -y ca-certificates 2>/dev/null || dnf install -y ca-certificates) && \
    (microdnf clean all 2>/dev/null || dnf clean all) && \
    groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /workspace && \
    chown -R harness:harness /workspace

COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
COPY --from=builder /app /app

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["bun", "run", "/app/apps/agentic-harness/src/index.ts"]

