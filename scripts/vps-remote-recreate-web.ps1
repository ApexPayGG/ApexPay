# Na VPS: pull + recreate serwisu web (nowy obraz GHCR). Wymaga .env.prod w $RemoteDir.
param(
  [string] $Server = "",
  [string] $RemoteDir = "/opt/apexpay-api"
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Server)) {
  $envSsh = [string]$env:APEXPAY_SSH
  if (-not [string]::IsNullOrWhiteSpace($envSsh)) {
    $Server = $envSsh.Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($Server)) {
  Write-Error "Podaj -Server uzytkownik@host lub ustaw APEXPAY_SSH."
}

$profile = ""
if ($env:APEXPAY_COMPOSE_PROFILE_SELFHOSTED -eq "1") {
  $profile = " --profile selfhosted"
}

$remoteCmd =
  "set -e; cd $RemoteDir && " +
  "docker compose -f docker-compose.prod.yml --env-file .env.prod$profile pull web && " +
  "docker compose -f docker-compose.prod.yml --env-file .env.prod$profile up -d --force-recreate web && " +
  "docker compose -f docker-compose.prod.yml --env-file .env.prod$profile ps web"

Write-Host "SSH: pull + recreate web ($Server)"
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new $Server "$remoteCmd"
