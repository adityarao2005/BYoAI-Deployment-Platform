#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Set default paths for this example (can be overridden if desired)
export AGENT_CONFIG_PATH="${AGENT_CONFIG_PATH:-${SCRIPT_DIR}/agent.yaml}"
export AGENT_SKILLS_PATH="${AGENT_SKILLS_PATH:-${SCRIPT_DIR}/skills.zip}"

# Only GEMINI_API_KEY is required
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

if [ ! -f "$AGENT_SKILLS_PATH" ]; then
    if [ -x "${SCRIPT_DIR}/create-skills-zip-file.sh" ] || [ -f "${SCRIPT_DIR}/create-skills-zip-file.sh" ]; then
        echo "Skills archive not found at '$AGENT_SKILLS_PATH'. Automatically generating skills.zip..."
        bash "${SCRIPT_DIR}/create-skills-zip-file.sh"
    fi
fi

if [ ! -f "$AGENT_SKILLS_PATH" ]; then
    echo "Error: Skills archive not found at: $AGENT_SKILLS_PATH" >&2
    exit 1
fi

echo "========================================="
echo " Starting Pet Adoption Agent"
echo "========================================="
echo " Config: $AGENT_CONFIG_PATH"
echo " Skills: $AGENT_SKILLS_PATH"
echo " Model:  gemini"
echo "========================================="
echo ""

exec bun run "${REPO_ROOT}/@byo-ai-agent-platform/apps/agentic-harness/src/index.ts"
