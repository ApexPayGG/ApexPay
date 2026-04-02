# Kopiuje aktualny docker-compose.prod.yml na VPS (wymaga OpenSSH: scp).
# NIE wklejaj tekstu z dokumentacji — podaj prawdziwe dane z VPS (jak w GitHub Secret HOST + USERNAME):
#   .\scripts\sync-prod-compose-to-server.ps1 -Server ubuntu@203.0.113.10
param(
  [Parameter(Mandatory = $true)]
  [string] $Server,
  [string] $RemoteDir = "/opt/apexpay-api"
)

$ErrorActionPreference = "Stop"
$s = $Server.ToLowerInvariant()
if ($s -match "twoj_user|ip_lub_host|your_user|example\.com|changeme|placeholder") {
  Write-Error "Parametr -Server wygląda na przykład z dokumentacji. Podaj prawdziwe dane SSH: uzytkownik@IP_lub_hostname (takie same jak HOST/USERNAME z wdrożenia)."
}
if ($Server -notmatch "@") {
  Write-Error "-Server musi być w formacie uzytkownik@host, np. ubuntu@203.0.113.10 lub deploy@api.twojadomena.pl"
}

$root = Split-Path $PSScriptRoot -Parent
$compose = Join-Path $root "docker-compose.prod.yml"
if (-not (Test-Path $compose)) {
  Write-Error "Nie znaleziono docker-compose.prod.yml (szukano: $compose)"
}

Write-Host "Kopiuję $compose → ${Server}:${RemoteDir}/"
scp $compose "${Server}:${RemoteDir}/docker-compose.prod.yml"
if ($LASTEXITCODE -ne 0) {
  Write-Error "scp zakończył się błędem (kod $LASTEXITCODE). Sprawdź host, klucz SSH i katalog $RemoteDir na serwerze."
}
Write-Host "Gotowe. Na serwerze: cd $RemoteDir && docker compose -f docker-compose.prod.yml --env-file .env.prod pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
