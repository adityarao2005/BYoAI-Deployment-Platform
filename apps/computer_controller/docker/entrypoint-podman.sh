#!/bin/sh
set -e

# If podman socket does not already exist, launch podman API system service in the background
if [ ! -S /run/podman/podman.sock ]; then
  mkdir -p /run/podman 2>/dev/null || true
  podman system service --time=0 unix:///run/podman/podman.sock &
  
  for i in $(seq 1 50); do
    if [ -S /run/podman/podman.sock ]; then
      break
    fi
    sleep 0.1
  done
fi

export DOCKER_HOST="${DOCKER_HOST:-unix:///run/podman/podman.sock}"
exec /app/controller "$@"
