#!/usr/bin/env bash
# Wgrywa docker-compose.prod.yml + refresh-traefik.sh na VPS i uruchamia refresh (compose up -d).
# Wymaga OpenSSH (ssh, scp) i klucza / BatchMode.
#
#   ./scripts/vps-apply-prod-compose.sh -s ubuntu@host
#   APEXPAY_SSH=ubuntu@host ./scripts/vps-apply-prod-compose.sh
# Selfhosted (Postgres/Redis w compose): APEXPAY_COMPOSE_PROFILE_SELFHOSTED=1 ./scripts/vps-apply-prod-compose.sh -s user@host
set -euo pipefail

REMOTE_DIR="${APEXPAY_REMOTE_DIR:-/opt/apexpay-api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Użycie: $0 -s USER@HOST  lub  APEXPAY_SSH=user@host $0" >&2
  echo "Opcje: --remote-dir ŚCIEŻKA   (domyślnie $REMOTE_DIR)" >&2
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
  echo "Błąd: podaj -s uzytkownik@host lub ustaw APEXPAY_SSH." >&2
  exit 1
fi

COMPOSE_FILE="$REPO_ROOT/docker-compose.prod.yml"
if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Błąd: brak pliku $COMPOSE_FILE" >&2
  exit 1
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)

echo "SCP docker-compose.prod.yml -> ${SERVER}:${REMOTE_DIR}/"
scp "${SSH_OPTS[@]}" "$COMPOSE_FILE" "${SERVER}:${REMOTE_DIR}/docker-compose.prod.yml"

echo "SCP refresh-traefik.sh -> ${SERVER}:${REMOTE_DIR}/"
scp "${SSH_OPTS[@]}" "$SCRIPT_DIR/refresh-traefik.sh" "${SERVER}:${REMOTE_DIR}/refresh-traefik.sh"

REMOTE_PREFIX=""
if [[ "${APEXPAY_COMPOSE_PROFILE_SELFHOSTED:-0}" == "1" ]]; then
  REMOTE_PREFIX="export APEXPAY_COMPOSE_PROFILE_SELFHOSTED=1; "
fi

REMOTE_CMD="${REMOTE_PREFIX}chmod +x ${REMOTE_DIR}/refresh-traefik.sh && bash ${REMOTE_DIR}/refresh-traefik.sh"
echo "SSH: $REMOTE_CMD"
ssh "${SSH_OPTS[@]}" "$SERVER" "$REMOTE_CMD"

echo "Gotowe."
