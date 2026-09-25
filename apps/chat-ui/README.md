# Chat UI (`apps/chat-ui`)

Browser-based web chat application for interacting with autonomous AI agents across interactive and non-interactive execution modes.

## Architecture
- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4 + `@assistant-ui/react` + Lucide icons.
- **Backend**: Go (Golang) HTTP server with `embed.FS` hosting the compiled SPA bundle.
- **Confidential OAuth2 Client**: Manages login, token exchange with PKCE, encrypted session cookies (`gorilla/sessions`), and token injection.
- **Direct Harness Proxy**: Proxies `/api/*` requests directly to `AGENT_HARNESS_URI` without exposing tokens to browser JavaScript.
- **SSE Stream Support**: Real-time event streaming (`agent:message`, `tool:call`, `tool:result`, `agent:complete`).
- **Input Locking**: Automatically locks text input while an agent is executing until `agent:complete` arrives.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `AGENT_HARNESS_URI` | Upstream Agentic Harness base URL | `http://localhost:3000` |
| `OAUTH_ISSUER_URI` | OAuth2 / OIDC authorization server URL | `http://localhost:8080/oauth` |
| `OAUTH_CLIENT_ID` | OAuth2 client ID | `byoai-chat-ui` |
| `OAUTH_CLIENT_SECRET` | OAuth2 client secret | `""` |
| `OAUTH_CALLBACK_PATH` | Relative callback path (e.g. `/auth/callback`) | `/auth/callback` |
| `SESSION_SECRET` | 32-byte secret for encrypting session cookies | `byoai-chat-ui-development-secret-32b` |
| `LISTEN_ADDR` | Server listen address | `:8081` |
| `LOG_LEVEL` | Log level (`debug`, `info`, `warn`, `error`) | `info` |

## Development & Execution

```bash
# Build React frontend
task chat_ui:build_frontend

# Run Go unit tests
task chat_ui:test

# Build complete binary (builds frontend and embeds into Go binary)
task chat_ui:build

# Run locally
task chat_ui:run
```
