# Build stage
FROM golang:1.24-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/byoai ./cmd/byoai

# Final stage
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=builder /bin/byoai /usr/local/bin/byoai

USER 65532:65532

ENTRYPOINT ["/usr/local/bin/byoai"]

