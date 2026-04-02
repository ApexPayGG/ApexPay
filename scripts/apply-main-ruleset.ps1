# Wymaga: winget install GitHub.cli  →  gh auth login  (scope: repo, admin:repo_hook dla niektórych org)
# Użycie z katalogu repo:
#   .\scripts\apply-main-ruleset.ps1 -Owner ApexPayGG -Repo ApexPay
# Opcjonalnie nadpisz plik JSON (np. inne nazwy checków): -RulesetJsonPath .\scripts\moj-ruleset.json

param(
  [string] $Owner = "ApexPayGG",
  [string] $Repo = "ApexPay",
  [string] $RulesetJsonPath = (Join-Path $PSScriptRoot "github-ruleset-main.json")
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "Brak 'gh'. Zainstaluj: winget install GitHub.cli"
}
if (-not (Test-Path -LiteralPath $RulesetJsonPath)) {
  Write-Error "Nie znaleziono pliku: $RulesetJsonPath"
}

$body = Get-Content -LiteralPath $RulesetJsonPath -Raw -Encoding UTF8
$rulesetsJson = gh api "repos/$Owner/$Repo/rulesets" --method GET 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Error "gh api rulesets failed: $rulesetsJson"
}

$rulesets = $rulesetsJson | ConvertFrom-Json
$existing = $rulesets | Where-Object { $_.name -eq "main" } | Select-Object -First 1

if ($null -ne $existing) {
  $id = $existing.id
  Write-Host "Aktualizacja rulesetu id=$id (PUT)..."
  gh api "repos/$Owner/$Repo/rulesets/$id" --method PUT --input $RulesetJsonPath
} else {
  Write-Host "Tworzenie rulesetu (POST)..."
  gh api "repos/$Owner/$Repo/rulesets" --method POST --input $RulesetJsonPath
}

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
Write-Host "Gotowe. Sprawdź: Ustawienia → Zasady → Zestawy reguł → main"
