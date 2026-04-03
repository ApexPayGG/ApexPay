# Uruchamia na VPS (przez SSH) `docker compose pull web` + recreate — NIE na lokalnym Windows Docker.
# GHCR: jednorazowo na serwerze: echo TOKEN | docker login ghcr.io -u NAZWA_GITHUB --password-stdin
param(
  [string] $HostName = "167.235.129.145",
  [string] $RemoteDir = "/opt/apexpay-api",
  [string] $User = "root"
)

$ErrorActionPreference = "Stop"
$remoteCmd =
  'set -e; cd ' + $RemoteDir +
  ' && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod pull web' +
  ' && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate web' +
  ' && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod ps web'

Write-Host "SSH (VPS): pull + recreate service web"
Write-Host "Jesli 'denied' z ghcr.io — zaloguj Docker na SERWERZE (nie na Windows): docker login ghcr.io"
ssh -o BatchMode=yes "${User}@${HostName}" $remoteCmd
