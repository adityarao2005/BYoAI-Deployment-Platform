# Dockerfile for Computer Controller daemon
# Minimal static container running on scratch or distroless

# -----------------------------------------------------------------------------
# Target 1: Scratch (minimal static container)
# -----------------------------------------------------------------------------
FROM scratch AS scratch

COPY docker/computer-local.yaml /app/computer.yaml
COPY bin/controller /app/controller

USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Target 2: Distroless (minimal static container with CA certs & non-root security)
# -----------------------------------------------------------------------------
FROM gcr.io/distroless/static-debian12:nonroot AS distroless

COPY docker/computer-local.yaml /app/computer.yaml
COPY bin/controller /app/controller

USER 65532:65532
WORKDIR /workspace
ENTRYPOINT ["/app/controller"]

# -----------------------------------------------------------------------------
# Target 3: Podman Mode (nested Podman-in-Podman sandbox engine)
# -----------------------------------------------------------------------------
FROM quay.io/podman/stable:latest AS podman

RUN mkdir -p /app /run/podman /etc/docker/certs && \
    chmod 777 /run/podman

COPY bin/controller /app/controller
COPY docker/computer-docker.yaml /app/computer.yaml
COPY docker/entrypoint-podman.sh /app/entrypoint.sh

RUN chmod 0444 /app/computer.yaml && \
    chmod 0555 /app/controller /app/entrypoint.sh

WORKDIR /app
ENTRYPOINT ["/app/entrypoint.sh"]