# API Gateway (`apps/api-gateway`)

OAuth2 Resource Server and programmatic API reverse proxy for external SDK clients and enterprise integrations.

## Overview
The API Gateway serves as a stateless firewall and Resource Server. It validates incoming JWT bearer tokens against a remote JWKS endpoint and proxies valid requests directly to the downstream `agentic-harness`.

## Architecture & Features
- **Stateless OAuth2 Resource Server**: Validates signatures via JWKS endpoint (`keyfunc/v3` + `golang-jwt/v5`).
- **SSE Streaming Support**: Proxies Server-Sent Event (SSE) streams unbuffered (`FlushInterval: -1`).
- **Configurable CORS**: Supports flexible origins, methods, and authorization headers.
- **Health Check**: `GET /health` endpoint bypassing authentication for load balancer probes.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_HARNESS_URI` | Base URL of the upstream Agentic Harness | `http://localhost:3000` |
| `JWKS_URI` | JWKS endpoint URL for validating JWT tokens | `""` |
| `JWT_ISSUER` | Expected token issuer (`iss`) claim | `""` |
| `JWT_AUDIENCE` | Expected token audience (`aud`) claim | `""` |
| `LISTEN_ADDR` | Server listen address | `:8080` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

## Development & Execution

```bash
# Run unit tests
task api_gateway:test

# Build binary
task api_gateway:build

# Run locally
task api_gateway:run
```
