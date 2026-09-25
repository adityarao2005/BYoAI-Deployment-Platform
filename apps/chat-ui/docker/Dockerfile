# Minimal distroless container running pre-built static Chat UI binary
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY bin/chat-ui /app/chat-ui

USER 65532:65532
EXPOSE 8081

ENTRYPOINT ["/app/chat-ui"]


