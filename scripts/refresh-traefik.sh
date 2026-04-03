#!/usr/bin/env bash
# Uruchamiaj WYŁĄCZNIE na VPS (Linux), w katalogu z docker-compose — bez git i bez npm.
# Domyślnie: katalog, w którym leży ten plik (np. po scp do /opt/apexpay-api/refresh-traefik.sh).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod)

"${COMPOSE[@]}" pull traefik
"${COMPOSE[@]}" up -d --force-recreate traefik
CID=$("${COMPOSE[@]}" ps -q traefik)
if [[ -n "${CID}" ]]; then
  docker logs --tail 45 "${CID}"
fi
