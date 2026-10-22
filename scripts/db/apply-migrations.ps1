<#
.SYNOPSIS
  Phase B du plan (prisma/manual-migrations/PLAN_20261023_numerotation.md) :
  applique les 4 migrations de numérotation sur Supabase, puis les contrôles.
  ÉCRIT EN BASE : à lancer uniquement après autorisation écrite de l'utilisateur.

.DESCRIPTION
  Étapes, arrêt à la première erreur (psql -v ON_ERROR_STOP=1, chaque
  migration encadrée par BEGIN/COMMIT) :
    A5  contrôle préalable (lecture seule)
    B1  migrations 1 → 4
    B2  postcheck (lecture seule)
    B3  instantané du catalogue + compare-schema.mjs --expect=after
    B4  tests PostgreSQL réels (écritures annulées par ROLLBACK)
  Prérequis : -BackupDir désigne une sauvegarde contenant RESTORE-VERIFIED.txt
  (scripts/db/verify-backup.ps1).
  Connexion : identique à backup.ps1 (pg-connection.ps1), jamais affichée.
  Journal complet : $HOME\gestly-backups\migration-<date>\ (hors du dépôt).

  -PrecheckOnly : exécute seulement A5, sans rien écrire.
  -RefreezeOnly : étape C2 du plan, juste après le déploiement de la branche :
                  relance la migration 4 (fige les factures créées entre-temps
                  par l'ancienne version, sans doublon) puis le postcheck.
#>
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [string]$OutRoot = (Join-Path $HOME "gestly-backups"),
  [switch]$PrecheckOnly,
  [switch]$RefreezeOnly
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
. (Join-Path $PSScriptRoot "pg-connection.ps1")

if (-not (Test-Path (Join-Path $BackupDir "RESTORE-VERIFIED.txt"))) {
  throw "Sauvegarde non prouvée restaurable : RESTORE-VERIFIED.txt absent de $BackupDir."
}

$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) { $psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe" }
if (-not (Test-Path $psql)) { throw "psql introuvable : installer PostgreSQL 17." }

$migrations = Join-Path $repo "prisma\manual-migrations"
$dir = Join-Path $OutRoot ("migration-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $dir | Out-Null
$log = Join-Path $dir "journal.txt"
Write-Host "Journal : $log"

# Exécute un fichier SQL ; échoue (exception) au premier échec de psql.
function Invoke-SqlStep([string]$Label, [string]$File, [string[]]$Extra = @()) {
  Write-Host ""
  Write-Host "=== $Label ($(Split-Path $File -Leaf))"
  Add-Content -Path $log -Encoding UTF8 -Value "`r`n=== $Label ($(Split-Path $File -Leaf)) $(Get-Date -Format o)"
  # Les NOTICE de psql arrivent sur stderr : en PowerShell 5.1, la redirection
  # 2>&1 lèverait une exception avec ErrorActionPreference = Stop.
  $ErrorActionPreference = "Continue"
  & $psql -X -v ON_ERROR_STOP=1 @Extra -f $File 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append | Write-Host
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "ÉCHEC à l'étape « $Label » (code psql $code). Les étapes suivantes n'ont pas été lancées." }
}

$found = Get-GestlyDatabaseUrl $repo.Path
$conn = ConvertTo-PgConnection $found.Url
Write-Host "Connexion : $($conn.Kind), port $($conn.Port) ; source : $($found.Source)"
$found = $null
Set-PgEnvironment $conn
$env:PGCLIENTENCODING = "UTF8"
try {
  if ($RefreezeOnly) {
    Invoke-SqlStep "C2 gel des nouvelles factures" (Join-Path $migrations "20261023_freeze_invoice_lines_up.sql")
    Invoke-SqlStep "C2 postcheck" (Join-Path $migrations "20261023_postcheck.sql")
    Write-Host "C2 TERMINÉE."
    return
  }
  Invoke-SqlStep "A5 contrôle préalable" (Join-Path $migrations "20261022_document_numbers_precheck.sql")
  if ($PrecheckOnly) { Write-Host "Contrôle seul (-PrecheckOnly) : aucune écriture."; return }

  Invoke-SqlStep "B1.1 compteurs" (Join-Path $migrations "20261023_document_number_counters_up.sql")
  Invoke-SqlStep "B1.2 numéros uniques" (Join-Path $migrations "20261022_unique_document_numbers_up.sql")
  Invoke-SqlStep "B1.3 suppression restreinte" (Join-Path $migrations "20261022_restrict_accounting_document_deletion_up.sql")
  Invoke-SqlStep "B1.4 gel des lignes de facture" (Join-Path $migrations "20261023_freeze_invoice_lines_up.sql")
  Invoke-SqlStep "B2 postcheck" (Join-Path $migrations "20261023_postcheck.sql")

  $snapshot = Join-Path $dir "snapshot-after.txt"
  Invoke-SqlStep "B3 instantané" (Join-Path $repo "scripts\db\catalog-snapshot.sql") @("-A", "-t", "-o", $snapshot)
  & node (Join-Path $repo "scripts\db\compare-schema.mjs") $snapshot --expect=after 2>&1 | ForEach-Object { "$_" } | Tee-Object -FilePath $log -Append | Write-Host
  if ($LASTEXITCODE -ne 0) { throw "ÉCHEC à l'étape « B3 comparaison » : le schéma n'est pas conforme à schema.prisma." }

  Invoke-SqlStep "B4 tests PostgreSQL" (Join-Path $migrations "20261023_pg_behaviour_tests.sql")
  Write-Host ""
  Write-Host "PHASE B TERMINÉE : migrations 1 → 4 appliquées, postcheck, schéma conforme, tests PostgreSQL OK."
} finally {
  Clear-PgEnvironment
  Remove-Item Env:PGCLIENTENCODING -ErrorAction SilentlyContinue
}
