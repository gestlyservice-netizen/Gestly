<#
.SYNOPSIS
  Preuve de restaurabilité d'une sauvegarde produite par scripts/db/backup.ps1.
  À LANCER PAR L'UTILISATEUR. N'utilise AUCUNE connexion à Supabase.

.DESCRIPTION
  1. Vérifie les empreintes SHA-256 des fichiers.
  2. Crée un serveur PostgreSQL 17 TEMPORAIRE et local (initdb dans %TEMP%,
     port 54329, accès limité à localhost), y restaure public.dump et
     supabase_migrations.dump avec arrêt à la première erreur.
  3. Compare le nombre de lignes de chaque table à counts-source.txt, et
     l'instantané du catalogue à snapshot-source.txt.
  4. Avec -Rehearse : applique les 4 migrations sur cette COPIE (vraies
     données), puis le postcheck, les tests de comportement et la
     comparaison avec schema.prisma (0 écart attendu).
  5. Arrête et supprime le serveur temporaire (sauf -Keep).
  Écrit RESTORE-VERIFIED.txt dans le dossier de sauvegarde en cas de succès.

  Prérequis : PostgreSQL 17 complet (initdb, pg_ctl, pg_restore, psql), Node.js.
#>
param(
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [switch]$Rehearse,
  [switch]$Keep
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$port = 54329

function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = "C:\Program Files\PostgreSQL\17\bin\$name.exe"
  if (Test-Path $candidate) { return $candidate }
  throw "$name introuvable : installer PostgreSQL 17 (winget install --id PostgreSQL.PostgreSQL.17 -e)."
}
$initdb = Find-PgTool "initdb"; $pgCtl = Find-PgTool "pg_ctl"; $pgRestore = Find-PgTool "pg_restore"
$psql = Find-PgTool "psql"; $createdb = Find-PgTool "createdb"
$local = "postgresql://postgres@localhost:$port/gestly_restore"

# 1. Empreintes.
foreach ($line in Get-Content (Join-Path $BackupDir "SHA256SUMS.txt")) {
  $hash, $name = $line -split "\s+", 2
  if ((Get-FileHash (Join-Path $BackupDir $name) -Algorithm SHA256).Hash -ne $hash) { throw "Empreinte incorrecte : $name" }
}
Write-Host "OK    Empreintes SHA-256"

$data = Join-Path $env:TEMP ("gestly-restore-" + (Get-Date -Format "yyyyMMddHHmmss"))
$results = @()
try {
  # 2. Serveur temporaire et restauration.
  & $initdb -D $data -U postgres -A trust -E UTF8 --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "initdb a échoué." }
  & $pgCtl -D $data -o "-p $port -c listen_addresses=localhost" -l (Join-Path $data "server.log") -w start | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Démarrage du serveur temporaire impossible (port $port occupé ?)." }
  & $createdb -h localhost -p $port -U postgres gestly_restore
  # La sauvegarde recrée le schéma public : on retire celui, vide, de la base neuve.
  & $psql -X -q -v ON_ERROR_STOP=1 -d $local -c "DROP SCHEMA public CASCADE;"
  foreach ($dump in "public.dump", "supabase_migrations.dump") {
    & $pgRestore --exit-on-error --no-owner --no-privileges -d $local (Join-Path $BackupDir $dump)
    if ($LASTEXITCODE -ne 0) { throw "Restauration de $dump en échec." }
  }
  $results += "OK    Restauration complète, sans erreur (public, supabase_migrations)"

  # 3. Comparaisons avec la base source.
  $countsSql = @"
SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
"@
  $restoredCounts = Join-Path $BackupDir "counts-restored.txt"
  & $psql -X -A -t -v ON_ERROR_STOP=1 -d $local -c $countsSql -o $restoredCounts
  $diffCounts = Compare-Object (Get-Content (Join-Path $BackupDir "counts-source.txt") | Where-Object { $_ }) (Get-Content $restoredCounts | Where-Object { $_ })
  if ($diffCounts) { $diffCounts | Format-Table | Out-String | Write-Host; throw "Nombre de lignes différent après restauration." }
  $results += "OK    Nombre de lignes identique pour chaque table ($(@(Get-Content $restoredCounts | Where-Object { $_ }).Count) tables)"

  $restoredSnap = Join-Path $BackupDir "snapshot-restored.txt"
  & $psql -X -A -t -v ON_ERROR_STOP=1 -d $local -f (Join-Path $repo "scripts\db\catalog-snapshot.sql") -o $restoredSnap
  $diffSnap = Compare-Object (Get-Content (Join-Path $BackupDir "snapshot-source.txt") | Where-Object { $_ }) (Get-Content $restoredSnap | Where-Object { $_ })
  if ($diffSnap) { $diffSnap | Format-Table | Out-String | Write-Host; throw "Structure différente après restauration (colonnes, index ou contraintes)." }
  $results += "OK    Structure identique : colonnes, index, contraintes et règles ON DELETE"

  # 4. Répétition des migrations sur la copie restaurée (vraies données).
  if ($Rehearse) {
    $mig = Join-Path $repo "prisma\manual-migrations"
    foreach ($f in "20261022_document_numbers_precheck.sql", "20261023_document_number_counters_up.sql", "20261022_unique_document_numbers_up.sql",
                   "20261022_restrict_accounting_document_deletion_up.sql", "20261023_freeze_invoice_lines_up.sql",
                   "20261023_postcheck.sql", "20261023_pg_behaviour_tests.sql") {
      Write-Host "--- $f"
      & $psql -X -v ON_ERROR_STOP=1 -d $local -f (Join-Path $mig $f)
      if ($LASTEXITCODE -ne 0) { throw "Répétition : $f en échec." }
    }
    $afterSnap = Join-Path $BackupDir "snapshot-rehearsal.txt"
    & $psql -X -A -t -v ON_ERROR_STOP=1 -d $local -f (Join-Path $repo "scripts\db\catalog-snapshot.sql") -o $afterSnap
    node (Join-Path $repo "scripts\db\compare-schema.mjs") $afterSnap --expect=after
    if ($LASTEXITCODE -ne 0) { throw "Répétition : schéma non conforme à schema.prisma après migrations." }
    $results += "OK    Répétition sur copie réelle : migrations 1-4, postcheck, tests PostgreSQL, 0 écart avec schema.prisma"
  }
}
finally {
  if (Test-Path $data) {
    & $pgCtl -D $data -m fast -w stop 2>$null | Out-Null
    if (-not $Keep) { Remove-Item -Recurse -Force $data }
  }
}
$results | ForEach-Object { Write-Host $_ }
@("Sauvegarde vérifiée le $(Get-Date -Format s)") + $results | Set-Content -Encoding utf8 (Join-Path $BackupDir "RESTORE-VERIFIED.txt")
Write-Host "SAUVEGARDE RESTAURABLE — preuve écrite dans RESTORE-VERIFIED.txt"
