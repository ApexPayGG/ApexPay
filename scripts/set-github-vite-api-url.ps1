# Ustawia zmienną repozytorium VITE_API_URL (build obrazu web w GitHub Actions).
# Wymaga: gh zalogowany (gh auth login), uprawnienia do repo.
# Przykład:
#   .\scripts\set-github-vite-api-url.ps1 -Repo ApexPayGG/ApexPay -Url https://api.twoja-domena.pl
param(
  [Parameter(Mandatory = $true)]
  [string] $Repo,
  [Parameter(Mandatory = $true)]
  [string] $Url
)

$ErrorActionPreference = "Stop"
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  $ghExe = "C:\Program Files\GitHub CLI\gh.exe"
  if (Test-Path $ghExe) {
    $env:Path += ";C:\Program Files\GitHub CLI"
  }
}
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Error "Brak gh. Zainstaluj GitHub CLI i: gh auth login"
}

if ($Url -match "/$") {
  Write-Error "Url bez końcowego slash, np. https://api.example.com"
}

gh variable set VITE_API_URL --body $Url --repo $Repo
Write-Host "Ustawiono VITE_API_URL dla $Repo (Actions → Variables)."
