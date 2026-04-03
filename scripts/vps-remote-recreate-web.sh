#!/usr/bin/env bash
# Na VPS: pull + force-recreate serwisu web. Wymaga .env.prod w katalogu zdalnym.
#
#   ./scripts/vps-remote-recreate-web.sh -s ubuntu@host
#   APEXPAY_COMPOSE_PROFILE_SELFHOSTED=1 ./scripts/vps-remote-recreate-web.sh -s user@host
set -euo pipefail

REMOTE_DIR="${APEXPAY_REMOTE_DIR:-/opt/apexpay-api}"

usage() {
  echo "Użycie: $0 -s USER@HOST  lub  APEXPAY_SSH=user@host $0" >&2
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

PROFILE_FLAG=""
if [[ "${APEXPAY_COMPOSE_PROFILE_SELFHOSTED:-0}" == "1" ]]; then
  PROFILE_FLAG=" --profile selfhosted"
fi

SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)

REMOTE_CMD="set -e; cd ${REMOTE_DIR} && \
docker compose -f docker-compose.prod.yml --env-file .env.prod${PROFILE_FLAG} pull web && \
docker compose -f docker-compose.prod.yml --env-file .env.prod${PROFILE_FLAG} up -d --force-recreate web && \
docker compose -f docker-compose.prod.yml --env-file .env.prod${PROFILE_FLAG} ps web"

echo "SSH: pull + recreate web ($SERVER)"
ssh "${SSH_OPTS[@]}" "$SERVER" "$REMOTE_CMD"
