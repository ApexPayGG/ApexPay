# Kopiuje aktualny docker-compose.prod.yml na VPS (wymaga OpenSSH: scp).
# Przykład:
#   .\scripts\sync-prod-compose-to-server.ps1 -Server deploy@203.0.113.10
param(
  [Parameter(Mandatory = $true)]
  [string] $Server,
  [string] $RemoteDir = "/opt/apexpay-api"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$compose = Join-Path $root "docker-compose.prod.yml"
if (-not (Test-Path $compose)) {
  Write-Error "Nie znaleziono docker-compose.prod.yml (szukano: $compose)"
}

Write-Host "Kopiuję $compose → ${Server}:${RemoteDir}/"
scp $compose "${Server}:${RemoteDir}/docker-compose.prod.yml"
Write-Host "Gotowe. Na serwerze: cd $RemoteDir && docker compose -f docker-compose.prod.yml --env-file .env.prod pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
