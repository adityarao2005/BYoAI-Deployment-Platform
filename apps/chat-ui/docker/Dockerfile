# Build frontend stage
FROM oven/bun:1 AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile || bun install

COPY frontend ./
RUN bun run build

# Build Go binary stage
FROM golang:1.24-alpine AS backend-builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /bin/chat-ui ./cmd/server

# Final stage
FROM alpine:3.21

RUN apk --no-cache add ca-certificates

WORKDIR /app
COPY --from=backend-builder /bin/chat-ui /app/chat-ui

EXPOSE 8081

ENTRYPOINT ["/app/chat-ui"]
