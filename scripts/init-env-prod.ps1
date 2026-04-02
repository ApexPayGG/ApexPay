# Tworzy lokalny .env.prod z szablonu (.env.prod.example). Plik jest ignorowany przez git (.env.*).
# Użycie:
#   .\scripts\init-env-prod.ps1
#   .\scripts\init-env-prod.ps1 -Force   # nadpisz istniejący .env.prod
param([switch] $Force)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$example = Join-Path $root ".env.prod.example"
$target = Join-Path $root ".env.prod"

if (-not (Test-Path $example)) {
  Write-Error "Brak pliku: $example"
}
if ((Test-Path $target) -and -not $Force) {
  Write-Host "Już istnieje: $target (użyj -Force aby nadpisać z szablonu)"
  exit 0
}

Copy-Item -LiteralPath $example -Destination $target -Force
Write-Host "Utworzono: $target"
Write-Host "1) Uzupełnij domeny, hasła, ghcr.io/.../apexpay-* oraz JWT_SECRET."
Write-Host "2) Sprawdź: npm run ops:check-env -- --env-file=.env.prod (m.in. @ w haśle URL, login = POSTGRES_USER)"
Write-Host "3) Wgraj na serwer: .\scripts\sync-prod-compose-to-server.ps1 -Server user@host -UploadEnvProd"
