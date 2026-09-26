#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Load .env if present
if [ -f "${SCRIPT_DIR}/.env" ]; then
    # shellcheck disable=SC1091
    set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

# Set default paths for this example (can be overridden if desired)
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-${SCRIPT_DIR}/agent.yaml}"
export OAUTH_JWKS_URI="${OAUTH_JWKS_URI:-http://localhost:8090/default/jwks}"
export OAUTH_ISSUER_URI="${OAUTH_ISSUER_URI:-http://localhost:8090/default}"

# Only GEMINI_API_KEY is required for the default model
if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "Error: Missing required environment variable: GEMINI_API_KEY" >&2
    echo "" >&2
    echo "Usage:" >&2
    echo "  export GEMINI_API_KEY=\"<your-api-key>\"" >&2
    echo "  $0" >&2
    echo "" >&2
    echo "Or configure a .env file from .env.example:" >&2
    echo "  cp .env.example .env" >&2
    exit 1
fi

if [ ! -f "$AGENT_CONFIG_PATH" ]; then
    echo "Error: Configuration file not found at: $AGENT_CONFIG_PATH" >&2
    exit 1
fi

echo "========================================="
echo " Starting Local Computer Use Agent"
echo "========================================="
echo " Config: $AGENT_CONFIG_PATH"
echo " Mode:   Local Host Execution"
echo " Model:  gemini"
echo "========================================="
echo ""

exec bun run "${REPO_ROOT}/apps/agentic-harness/src/index.ts"
