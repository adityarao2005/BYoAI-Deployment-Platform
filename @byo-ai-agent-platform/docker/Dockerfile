# Dockerfile for Agentic Harness runtime
# Multi-stage build that selects the compiled Linux binary (x64 vs arm64) based on TARGETARCH

# -----------------------------------------------------------------------------
# Binary Selector Stage: picks the correct compiled Linux binary for TARGETARCH
# -----------------------------------------------------------------------------
FROM alpine:latest AS binary-selector
ARG TARGETARCH
WORKDIR /src
COPY dist/agentic-harness-linux-* ./
RUN if [ "$TARGETARCH" = "amd64" ] || [ -z "$TARGETARCH" ]; then \
      cp agentic-harness-linux-x64 /agentic-harness; \
    elif [ "$TARGETARCH" = "arm64" ]; then \
      cp agentic-harness-linux-arm64 /agentic-harness; \
    else \
      echo "Unsupported target architecture: $TARGETARCH" && exit 1; \
    fi

# -----------------------------------------------------------------------------
# Target 1: Distroless (Recommended: glibc, ca-certificates, non-root security)
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/cc-debian12 AS distroless

COPY --from=binary-selector /agentic-harness /app/agentic-harness

USER 65532:65532
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["/app/agentic-harness"]

# -----------------------------------------------------------------------------
# Target 2: Debian (bookworm-slim)
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS debian

RUN groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /app /workspace && \
    chown -R harness:harness /workspace

COPY --from=binary-selector /agentic-harness /app/agentic-harness
RUN chmod 0555 /app/agentic-harness

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["/app/agentic-harness"]

# -----------------------------------------------------------------------------
# Target 3: RedHat (UBI 9 Minimal)
# -----------------------------------------------------------------------------
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest AS redhat

RUN microdnf install -y ca-certificates && \
    microdnf clean all && \
    groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /app /workspace && \
    chown -R harness:harness /workspace

COPY --from=binary-selector /agentic-harness /app/agentic-harness
RUN chmod 0555 /app/agentic-harness

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["/app/agentic-harness"]

# -----------------------------------------------------------------------------
# Target 4: RedHat (UBI 10 Minimal)
# -----------------------------------------------------------------------------
FROM registry.access.redhat.com/ubi10/ubi-minimal:latest AS ubi10-minimal

RUN (microdnf install -y ca-certificates 2>/dev/null || dnf install -y ca-certificates) && \
    groupadd -g 10001 harness && \
    useradd -u 10001 -g harness -m -d /workspace harness && \
    mkdir -p /app /workspace && \
    chown -R harness:harness /workspace

COPY --from=binary-selector /agentic-harness /app/agentic-harness
RUN chmod 0555 /app/agentic-harness

USER 10001:10001
WORKDIR /workspace
EXPOSE 3000
ENTRYPOINT ["/app/agentic-harness"]
