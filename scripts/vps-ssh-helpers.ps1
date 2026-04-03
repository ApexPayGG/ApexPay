# Ładowane przez inne skrypty vps-*.ps1
function Get-LfOnlyTempFile {
  param([Parameter(Mandatory)][string] $SourcePath)
  $raw = [System.IO.File]::ReadAllText($SourcePath)
  $normalized = $raw -replace "`r`n", "`n" -replace "`r", "`n"
  $tmp = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllText($tmp, $normalized, [System.Text.UTF8Encoding]::new($false))
  return $tmp
}
