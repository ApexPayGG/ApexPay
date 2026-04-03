#!/usr/bin/env bash
# Uruchamiaj na VPS w katalogu z compose (np. /opt/apexpay-api).
# Zgodne z wdrożeniem CI: tylko docker-compose.prod.yml + opcjonalnie .env.prod.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

COMPOSE_CMD=(docker compose -f docker-compose.prod.yml)
if [[ -f .env.prod ]]; then
  COMPOSE_CMD+=(--env-file .env.prod)
fi
if [[ "${APEXPAY_COMPOSE_PROFILE_SELFHOSTED:-0}" == "1" ]]; then
  COMPOSE_CMD+=(--profile selfhosted)
fi

echo "[refresh-traefik] ${COMPOSE_CMD[*]} up -d"
"${COMPOSE_CMD[@]}" up -d

echo "[refresh-traefik] stan kontenerów:"
"${COMPOSE_CMD[@]}" ps
