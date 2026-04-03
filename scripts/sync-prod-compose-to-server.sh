#!/usr/bin/env bash
# Kopiuje docker-compose.prod.yml na VPS; opcjonalnie .env.prod.
#
#   ./scripts/sync-prod-compose-to-server.sh -s ubuntu@host
#   ./scripts/sync-prod-compose-to-server.sh -s user@host --upload-env-prod
set -euo pipefail

REMOTE_DIR="${APEXPAY_REMOTE_DIR:-/opt/apexpay-api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UPLOAD_ENV=0

usage() {
  echo "Użycie: $0 -s USER@HOST [--upload-env-prod] [--remote-dir ŚCIEŻKA]" >&2
  exit 1
}

SERVER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--server)
      [[ $# -ge 2 ]] || usage
      SERVER="$2"
      shift 2
      ;;
    --remote-dir)
      [[ $# -ge 2 ]] || usage
      REMOTE_DIR="$2"
      shift 2
      ;;
    --upload-env-prod)
      UPLOAD_ENV=1
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      if [[ -z "$SERVER" && "$1" == *@* ]]; then
        SERVER="$1"
        shift
      else
        usage
      fi
      ;;
  esac
done

if [[ -z "$SERVER" ]]; then
  SERVER="${APEXPAY_SSH:-}"
fi
SERVER="${SERVER#"${SERVER%%[![:space:]]*}"}"
SERVER="${SERVER%"${SERVER##*[![:space:]]}"}"

if [[ -z "$SERVER" || "$SERVER" != *@* ]]; then
  echo "Błąd: podaj -s uzytkownik@host." >&2
  exit 1
fi

lower=$(printf '%s' "$SERVER" | tr '[:upper:]' '[:lower:]')
case "$lower" in
  *twoj_user*|*ip_lub_host*|*your_user*|*changeme*|*example.com*|*placeholder*)
    echo "Błąd: -s wygląda na przykład z dokumentacji — podaj prawdziwe user@host." >&2
    exit 1
    ;;
esac

COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Błąd: nie znaleziono $COMPOSE_FILE" >&2
  exit 1
fi

echo "Kopiuję $COMPOSE_FILE → ${SERVER}:${REMOTE_DIR}/"
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
  "$COMPOSE_FILE" "${SERVER}:${REMOTE_DIR}/docker-compose.prod.yml"

if [[ "$UPLOAD_ENV" -eq 1 ]]; then
  ENV_PROD="$REPO_ROOT/.env.prod"
  if [[ ! -f "$ENV_PROD" ]]; then
    echo "Błąd: brak $ENV_PROD — uzupełnij lub pomiń --upload-env-prod." >&2
    exit 1
  fi
  echo "Kopiuję $ENV_PROD → ${SERVER}:${REMOTE_DIR}/.env.prod"
  scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
    "$ENV_PROD" "${SERVER}:${REMOTE_DIR}/.env.prod"
fi

echo "Gotowe."
