#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "========================================================"
echo " BYoAI Platform - Pet Adoption Agent Shell Launcher"
echo "========================================================"

# Check if .env exists, or prompt / load from environment
if [ -f "${SCRIPT_DIR}/.env" ]; then
    echo "Loading environment variables from ${SCRIPT_DIR}/.env..."
    # shellcheck disable=SC1091
    set -a; source "${SCRIPT_DIR}/.env"; set +a
fi

if [ -z "${GEMINI_API_KEY:-}" ]; then
    echo "Warning: GEMINI_API_KEY is not set."
    echo "Please set GEMINI_API_KEY in your shell or create a .env file from .env.example:"
    echo "  export GEMINI_API_KEY=\"<your-api-key>\""
    echo ""
    read -rp "Enter GEMINI_API_KEY (or press Enter if configured via container): " input_key || true
    if [ -n "$input_key" ]; then
        export GEMINI_API_KEY="$input_key"
    fi
fi

# Ensure skills.zip is packaged
if [ ! -f "${SCRIPT_DIR}/skills.zip" ]; then
    echo "Packaging skills archive..."
    bash "${SCRIPT_DIR}/create-skills-zip-file.sh"
fi

# Check if backend container images exist, or prompt to build them
echo "Checking required container images..."
REQUIRED_IMAGES=("agentic-harness:latest" "computer-controller:distroless")
MISSING_IMAGES=0

for img in "${REQUIRED_IMAGES[@]}"; do
    if ! docker image inspect "$img" >/dev/null 2>&1; then
        echo "Missing image: $img"
        MISSING_IMAGES=1
    fi
done

if [ "$MISSING_IMAGES" -eq 1 ]; then
    echo "Building container images via Taskfile..."
    (cd "$REPO_ROOT" && task build_container_images)
fi

# Ensure local shell binary is built
CLI_BIN="${REPO_ROOT}/apps/shell-cli/bin/byoai"
if [ ! -f "$CLI_BIN" ]; then
    echo "Building local Shell CLI binary..."
    (cd "$REPO_ROOT" && task shell_cli:build)
fi

echo ""
echo "Starting backend services in Docker..."
cd "${SCRIPT_DIR}"
docker compose -f compose.yaml up -d oauth-provider computer-controller agentic-harness

echo ""
echo "Launching local Shell CLI interactive session..."
echo "========================================================"
exec "$CLI_BIN" -config "${SCRIPT_DIR}/shell-config.yaml" "$@"
