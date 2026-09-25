#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

echo "========================================================"
echo " BYoAI Platform - Full Stack Docker Compose Orchestrator"
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

# Check if container images exist, or prompt to build them
echo "Checking required container images..."
REQUIRED_IMAGES=("agentic-harness:latest" "computer-controller:distroless" "chat-ui:latest")
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

echo ""
echo "Starting Full Stack Compose services:"
echo "  - Identity Provider (Mock OAuth2/OIDC): http://localhost:8090/default"
echo "  - Computer Controller:                 http://localhost:8080"
echo "  - Agentic Harness Runtime:             http://localhost:3000"
echo "  - Chat UI (Web Frontend):              http://localhost:8081"
echo ""
echo "Press Ctrl+C to stop all services."
echo "========================================================"

cd "${SCRIPT_DIR}"
exec docker compose up "$@"
