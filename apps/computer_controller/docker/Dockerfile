# Dockerfile for Computer Controller daemon
# Copies pre-built static binary from bin/controller into target distribution images

# -----------------------------------------------------------------------------
# Local Mode Target 1: Scratch (minimal static container)
# -----------------------------------------------------------------------------
FROM scratch AS local-scratch

COPY docker/computer-local.yaml /app/computer.yaml
COPY bin/controller /app/controller

USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Local Mode Target 2: Alpine
# -----------------------------------------------------------------------------
FROM alpine:latest AS local-alpine

RUN addgroup -g 10001 controller && \
    adduser -u 10001 -G controller -h /workspace -D controller && \
    mkdir -p /app /workspace && \
    chown -R controller:controller /workspace

COPY bin/controller /app/controller
COPY docker/computer-local.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Local Mode Target 3: Debian
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS local-debian

RUN groupadd -g 10001 controller && \
    useradd -u 10001 -g controller -m -d /workspace controller && \
    mkdir -p /app /workspace && \
    chown -R controller:controller /workspace

COPY bin/controller /app/controller
COPY docker/computer-local.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Local Mode Target 4: RedHat (UBI 9 Minimal)
# -----------------------------------------------------------------------------
FROM registry.access.redhat.com/ubi9/ubi-minimal:latest AS local-redhat

RUN groupadd -g 10001 controller && \
    useradd -u 10001 -g controller -m -d /workspace controller && \
    mkdir -p /app /workspace && \
    chown -R controller:controller /workspace

COPY bin/controller /app/controller
COPY docker/computer-local.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Docker/Podman Mode Target 1: RedHat (quay.io/podman/stable)
# -----------------------------------------------------------------------------
FROM quay.io/podman/stable:latest AS docker-podman-redhat

RUN groupadd -g 10001 controller 2>/dev/null || true && \
    useradd -u 10001 -g controller -m -d /app controller 2>/dev/null || true && \
    mkdir -p /app /etc/docker/certs

COPY bin/controller /app/controller
COPY docker/computer-docker.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /app
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Docker/Podman Mode Target 2: Debian
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS docker-podman-debian

RUN apt-get update && \
    apt-get install -y --no-install-recommends podman ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    groupadd -g 10001 controller && \
    useradd -u 10001 -g controller -m -d /app controller && \
    mkdir -p /app /etc/docker/certs

COPY bin/controller /app/controller
COPY docker/computer-docker.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /app
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Docker/Podman Mode Target 3: Alpine
# -----------------------------------------------------------------------------
FROM alpine:latest AS docker-podman-alpine

RUN apk add --no-cache podman ca-certificates && \
    addgroup -g 10001 controller && \
    adduser -u 10001 -G controller -h /app -D controller && \
    mkdir -p /app /etc/docker/certs

COPY bin/controller /app/controller
COPY docker/computer-docker.yaml /app/computer.yaml
RUN chmod 0444 /app/computer.yaml && chmod 0555 /app/controller

USER 10001:10001
WORKDIR /app
ENTRYPOINT ["/app/controller"]