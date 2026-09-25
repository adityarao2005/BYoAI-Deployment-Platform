# Minimal distroless container running pre-built static API Gateway binary
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY bin/gateway /app/gateway

USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["/app/gateway"]
