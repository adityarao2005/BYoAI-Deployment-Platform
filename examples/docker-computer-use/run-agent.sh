#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Set default paths for this example
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-${SCRIPT_DIR}/agent.yaml}"

if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "Error: Missing required environment variable: GEMINI_API_KEY" >&2
    echo "" >&2
    echo "Usage:" >&2
    echo "  export GEMINI_API_KEY=\"<your-api-key>\"" >&2
    echo "  $0" >&2
    echo "" >&2
    echo "Or as a one-liner:" >&2
    echo "  GEMINI_API_KEY=\"<your-api-key>\" $0" >&2
    exit 1
fi

if [ ! -f "$AGENT_CONFIG_PATH" ]; then
    echo "Error: Configuration file not found at: $AGENT_CONFIG_PATH" >&2
    exit 1
fi

echo "========================================="
echo " Starting Docker Computer Use Agent"
echo "========================================="
echo " Config: $AGENT_CONFIG_PATH"
echo " Mode:   Remote Docker Execution (http://localhost:8080)"
echo " Model:  gemini"
echo "========================================="
echo ""
echo "Note: Ensure Computer Controller is running with Docker mode."
echo "      (e.g. cd apps/computer_controller && task run)"
echo ""

exec bun run "${REPO_ROOT}/apps/agentic-harness/src/index.ts"
