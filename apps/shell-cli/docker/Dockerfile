# Minimal distroless container running pre-built static Shell CLI binary
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY bin/byoai /usr/local/bin/byoai

USER 65532:65532

ENTRYPOINT ["/usr/local/bin/byoai"]


