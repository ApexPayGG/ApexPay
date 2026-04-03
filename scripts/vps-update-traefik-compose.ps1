# Wgrywa lokalny docker-compose.prod.yml na VPS i przeładowuje tylko Traefika.
# Uruchom w terminalu Cursor na maszynie, gdzie działa `ssh root@...` (agent / klucz).
param(
  [string] $HostName = "167.235.129.145",
  [string] $RemoteDir = "/opt/apexpay-api",
  [string] $User = "root"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$composeFile = Join-Path $repoRoot "docker-compose.prod.yml"

if (-not (Test-Path $composeFile)) {
  Write-Error "Brak pliku: $composeFile"
}

$remote = "${User}@${HostName}:${RemoteDir}/docker-compose.prod.yml"
Write-Host "SCP -> $remote"
# BatchMode: bez interaktywnego hasła — przy braku klucza szybki błąd zamiast wiszenia.
scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new $composeFile $remote

# Jedna linia dla bash na serwerze; $(...) wykonuje się po stronie zdalnej (string PS w pojedynczych cudzysłowach).
$remoteCmd =
  'cd ' + $RemoteDir +
  ' && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod pull traefik' +
  ' && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d --force-recreate traefik' +
  ' && docker logs --tail 35 $(docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod ps -q traefik)'

Write-Host "SSH: pull + recreate traefik + logi"
ssh -o BatchMode=yes "${User}@${HostName}" $remoteCmd
