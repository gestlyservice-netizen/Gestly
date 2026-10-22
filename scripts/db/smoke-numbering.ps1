<#
.SYNOPSIS
  Lance scripts/db/smoke-numbering.ts contre la base de l'application.
  Connexion : pg-connection.ps1 (même source que backup.ps1), transmise au
  seul processus enfant par DATABASE_URL, jamais affichée.
  Le test s'exécute dans une transaction annulée : aucune donnée ne reste.
#>
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $PSScriptRoot "pg-connection.ps1")

$found = Get-GestlyDatabaseUrl $repo.Path
Write-Host "Connexion : source $($found.Source)"
$env:DATABASE_URL = $found.Url
$found = $null
$env:OUTBOUND_MODE = "simulate"
try {
  Push-Location $repo
  & npx.cmd tsx --tsconfig tsconfig.json scripts\db\smoke-numbering.ts
  if ($LASTEXITCODE -ne 0) { throw "Test de fumée en échec." }
} finally {
  Pop-Location
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OUTBOUND_MODE -ErrorAction SilentlyContinue
}
