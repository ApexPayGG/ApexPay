# Wgrywa lokalny docker-compose.prod.yml + scripts/refresh-traefik.sh na VPS i
# przeładowuje Traefika (bash na serwerze — bez npm i bez git).
# Uruchom w terminalu Cursor na maszynie, gdzie działa `ssh root@...` (agent / klucz).
param(
  [string] $HostName = "167.235.129.145",
  [string] $RemoteDir = "/opt/apexpay-api",
  [string] $User = "root"
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$composeFile = Join-Path $repoRoot "docker-compose.prod.yml"
$refreshScript = Join-Path $PSScriptRoot "refresh-traefik.sh"

if (-not (Test-Path $composeFile)) {
  Write-Error "Brak pliku: $composeFile"
}
if (-not (Test-Path $refreshScript)) {
  Write-Error "Brak pliku: $refreshScript"
}

$scpArgs = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new")

Write-Host "SCP docker-compose.prod.yml -> ${User}@${HostName}:${RemoteDir}/"
scp @scpArgs $composeFile "${User}@${HostName}:${RemoteDir}/docker-compose.prod.yml"

Write-Host "SCP refresh-traefik.sh -> ${User}@${HostName}:${RemoteDir}/"
scp @scpArgs $refreshScript "${User}@${HostName}:${RemoteDir}/refresh-traefik.sh"

$remoteCmd = "chmod +x ${RemoteDir}/refresh-traefik.sh && bash ${RemoteDir}/refresh-traefik.sh"
Write-Host "SSH: $remoteCmd"
ssh -o BatchMode=yes "${User}@${HostName}" $remoteCmd
