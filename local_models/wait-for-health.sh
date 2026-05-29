#!/usr/bin/env bash
set -eu

# Wait for Docker Compose containers in the current project to reach a final health state
# Usage: wait-for-health.sh [timeout-seconds]

timeout=${1:-300}
interval=2
end_time=$((SECONDS + timeout))

containers=( $(docker compose ps -q) )
if [ ${#containers[@]} -eq 0 ]; then
  echo "No containers found from 'docker compose ps -q'" >&2
  exit 2
fi

echo "Waiting up to ${timeout}s for ${#containers[@]} container(s) to report health status..."

while [ $SECONDS -le $end_time ]; do
  all_final=true
  unhealthy_found=false

  for cid in "${containers[@]}"; do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo missing)

    case "$status" in
      healthy)
        ;;
      unhealthy)
        unhealthy_found=true
        ;;
      none|missing)
        # No healthcheck configured for this container; treat as already final
        ;;
      *)
        all_final=false
        ;;
    esac
  done

  if $all_final; then
    if $unhealthy_found; then
      echo "One or more containers are unhealthy" >&2
      docker compose ps
      exit 1
    else
      echo "All containers healthy or have no healthcheck configured"
      docker compose ps
      exit 0
    fi
  fi

  sleep $interval
done

echo "Timed out waiting for container healthchecks" >&2
docker compose ps
exit 3
