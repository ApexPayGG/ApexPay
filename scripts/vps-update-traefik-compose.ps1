# Wgrywa docker-compose.prod.yml + refresh-traefik.sh i uruchamia `compose up -d` na VPS.
# Domyślny host: zmienna APEXPAY_SSH lub parametr -Server (bez hardkodowanego IP w repo).
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
  Write-Error "Użycie: .\scripts\vps-update-traefik-compose.ps1 -Server uzytkownik@host   lub   `$env:APEXPAY_SSH='uzytkownik@host'"
}
& "$PSScriptRoot\vps-apply-prod-compose.ps1" -Server $Server -RemoteDir $RemoteDir
