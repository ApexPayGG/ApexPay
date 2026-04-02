# Kopiuje docker-compose.prod.yml na VPS; opcjonalnie .env.prod (wymaga OpenSSH: scp).
#   .\scripts\sync-prod-compose-to-server.ps1 -Server ubuntu@203.0.113.10
#   .\scripts\sync-prod-compose-to-server.ps1 -Server ubuntu@1.2.3.4 -UploadEnvProd
param(
  [Parameter(Mandatory = $true)]
  [string] $Server,
  [string] $RemoteDir = "/opt/apexpay-api",
  [switch] $UploadEnvProd
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

if ($UploadEnvProd) {
  $envProd = Join-Path $root ".env.prod"
  if (-not (Test-Path $envProd)) {
    Write-Error "Brak $envProd — uruchom najpierw: .\scripts\init-env-prod.ps1 i uzupełnij wartości."
  }
  Write-Host "Kopiuję $envProd → ${Server}:${RemoteDir}/.env.prod"
  scp $envProd "${Server}:${RemoteDir}/.env.prod"
  if ($LASTEXITCODE -ne 0) {
    Write-Error "scp .env.prod zakończył się błędem (kod $LASTEXITCODE)."
  }
}

Write-Host @"
Gotowe.
Na serwerze (self-hosted DB/Redis/Rabbit):
  cd $RemoteDir && docker compose -f docker-compose.prod.yml --profile selfhosted --env-file .env.prod pull && docker compose -f docker-compose.prod.yml --profile selfhosted --env-file .env.prod up -d
Managed DB (bez profilu selfhosted):
  cd $RemoteDir && docker compose -f docker-compose.prod.yml --env-file .env.prod pull && docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
"@
