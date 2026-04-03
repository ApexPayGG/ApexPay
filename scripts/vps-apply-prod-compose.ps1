# Wgrywa docker-compose.prod.yml na VPS i wykonuje `docker compose ... up -d` (nowe labele Traefik / api-inapp).
# Wymaga działającego SSH (klucz w agencie lub skonfigurowany w ~/.ssh/config).
#
#   .\scripts\vps-apply-prod-compose.ps1 -Server ubuntu@twoj.host
#   $env:APEXPAY_SSH = "ubuntu@1.2.3.4"; .\scripts\vps-apply-prod-compose.ps1
param(
  [string] $Server = "",
  [string] $RemoteDir = "/opt/apexpay-api"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\vps-ssh-helpers.ps1"

if ([string]::IsNullOrWhiteSpace($Server)) {
  $envSsh = [string]$env:APEXPAY_SSH
  if (-not [string]::IsNullOrWhiteSpace($envSsh)) {
    $Server = $envSsh.Trim()
  }
}
if ([string]::IsNullOrWhiteSpace($Server)) {
  Write-Error "Podaj -Server w formacie uzytkownik@host lub ustaw zmienną środowiskową APEXPAY_SSH."
}
if ($Server -notmatch "@") {
  Write-Error "-Server musi być w formacie uzytkownik@host."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$composeFile = Join-Path $repoRoot "docker-compose.prod.yml"
if (-not (Test-Path $composeFile)) {
  Write-Error "Brak pliku: $composeFile"
}

$scpArgs = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")
Write-Host "SCP docker-compose.prod.yml -> ${Server}:${RemoteDir}/"
scp @scpArgs $composeFile "${Server}:${RemoteDir}/docker-compose.prod.yml"
if ($LASTEXITCODE -ne 0) {
  Write-Error "scp nie powiodło się (kod $LASTEXITCODE)."
}

$refreshScript = Join-Path $PSScriptRoot "refresh-traefik.sh"
$tmpRefresh = Get-LfOnlyTempFile -SourcePath $refreshScript
try {
  Write-Host "SCP refresh-traefik.sh -> ${Server}:${RemoteDir}/"
  scp @scpArgs $tmpRefresh "${Server}:${RemoteDir}/refresh-traefik.sh"
} finally {
  Remove-Item -Force -ErrorAction SilentlyContinue $tmpRefresh
}
if ($LASTEXITCODE -ne 0) {
  Write-Error "scp refresh-traefik.sh nie powiodło się."
}

$remotePrefix = ""
if ($env:APEXPAY_COMPOSE_PROFILE_SELFHOSTED -eq "1") {
  $remotePrefix = "export APEXPAY_COMPOSE_PROFILE_SELFHOSTED=1; "
}
$remoteCmd = "${remotePrefix}chmod +x ${RemoteDir}/refresh-traefik.sh && bash ${RemoteDir}/refresh-traefik.sh"
Write-Host "SSH: $remoteCmd"
ssh @scpArgs $Server "$remoteCmd"
if ($LASTEXITCODE -ne 0) {
  Write-Error "SSH zakończył się błędem (kod $LASTEXITCODE). Na serwerze z profilem selfhosted ustaw przed SSH: export APEXPAY_COMPOSE_PROFILE_SELFHOSTED=1 (albo uruchom ręcznie compose z --profile selfhosted)."
}

Write-Host "Gotowe."
