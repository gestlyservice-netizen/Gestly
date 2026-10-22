<#
.SYNOPSIS
  Sauvegarde de la base Gestly (Supabase) avant les migrations de numérotation.
  À LANCER PAR L'UTILISATEUR, dans son propre terminal PowerShell.

.DESCRIPTION
  Lecture seule sur la base. Produit, dans un dossier HORS du dépôt
  ($HOME\gestly-backups\<date>) :
    public.dump               schéma public complet (structure, données, contraintes, index, RLS), format custom
    supabase_migrations.dump  historique des migrations Supabase
    public-schema.sql         structure lisible (texte)
    counts-source.txt         nombre exact de lignes par table
    snapshot-source.txt       instantané du catalogue (scripts/db/catalog-snapshot.sql)
    SHA256SUMS.txt            empreintes des fichiers
  Une sauvegarde n'est considérée comme valable qu'après scripts/db/verify-backup.ps1.

  Prérequis : outils clients PostgreSQL 17 (pg_dump, psql), par exemple :
    winget install --id PostgreSQL.PostgreSQL.17 -e
  Connexion : variable $env:GESTLY_DB_URL = URI « Session pooler » (port 5432) copiée
  depuis Supabase → Connect. Elle n'est jamais affichée ni écrite sur disque.
  Si elle est absente, le script la demande en saisie masquée.
#>
param(
  [string]$OutRoot = (Join-Path $HOME "gestly-backups")
)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = "C:\Program Files\PostgreSQL\17\bin\$name.exe"
  if (Test-Path $candidate) { return $candidate }
  throw "$name introuvable : installer PostgreSQL 17 (winget install --id PostgreSQL.PostgreSQL.17 -e)."
}
$pgDump = Find-PgTool "pg_dump"
$psql = Find-PgTool "psql"
$pgRestore = Find-PgTool "pg_restore"
$version = & $pgDump --version
if ($version -notmatch "\s(1[7-9]|[2-9]\d)\.") { throw "pg_dump 17 ou plus requis (serveur Supabase 17.6) ; trouvé : $version" }

$url = $env:GESTLY_DB_URL
if (-not $url) {
  $secure = Read-Host "URI de connexion « Session pooler » (saisie masquée)" -AsSecureString
  $url = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
if ($url -notmatch "^postgres(ql)?://") { throw "URI de connexion invalide (doit commencer par postgresql://)." }
if ($url -notmatch "sslmode=") { $url += $(if ($url.Contains("?")) { "&" } else { "?" }) + "sslmode=require" }

$dir = Join-Path $OutRoot (Get-Date -Format "yyyyMMdd-HHmmss")
if ($dir.StartsWith($repo.Path, [StringComparison]::OrdinalIgnoreCase)) { throw "Le dossier de sauvegarde doit être hors du dépôt." }
New-Item -ItemType Directory -Force $dir | Out-Null
Write-Host "Sauvegarde dans $dir"

$countsSql = @"
SELECT table_name || '|' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
"@

& $pgDump --dbname=$url --format=custom --schema=public --no-owner --no-privileges --file=(Join-Path $dir "public.dump")
if ($LASTEXITCODE -ne 0) { throw "pg_dump (public) a échoué." }
& $pgDump --dbname=$url --format=custom --schema=supabase_migrations --no-owner --no-privileges --file=(Join-Path $dir "supabase_migrations.dump")
if ($LASTEXITCODE -ne 0) { throw "pg_dump (supabase_migrations) a échoué." }
& $pgDump --dbname=$url --schema-only --schema=public --no-owner --no-privileges --file=(Join-Path $dir "public-schema.sql")
if ($LASTEXITCODE -ne 0) { throw "pg_dump (structure) a échoué." }
& $psql --dbname=$url -X -A -t -v ON_ERROR_STOP=1 -c $countsSql -o (Join-Path $dir "counts-source.txt")
if ($LASTEXITCODE -ne 0) { throw "Comptage des lignes a échoué." }
& $psql --dbname=$url -X -A -t -v ON_ERROR_STOP=1 -f (Join-Path $repo "scripts\db\catalog-snapshot.sql") -o (Join-Path $dir "snapshot-source.txt")
if ($LASTEXITCODE -ne 0) { throw "Instantané du catalogue a échoué." }
$url = $null

# Contrôle de lisibilité immédiat : la table des matières doit lister les données des 22 tables.
$toc = & $pgRestore --list (Join-Path $dir "public.dump")
$dataEntries = @($toc | Select-String "TABLE DATA public ").Count
$tables = @(Get-Content (Join-Path $dir "counts-source.txt") | Where-Object { $_ -match "\|" }).Count

Get-ChildItem $dir -File | Where-Object Name -ne "SHA256SUMS.txt" | ForEach-Object {
  "{0}  {1}" -f (Get-FileHash $_.FullName -Algorithm SHA256).Hash, $_.Name
} | Set-Content -Encoding utf8 (Join-Path $dir "SHA256SUMS.txt")

Get-ChildItem $dir -File | Format-Table Name, Length -AutoSize
Write-Host "Tables comptées : $tables ; entrées de données dans public.dump : $dataEntries"
if ($dataEntries -ne $tables -or $tables -lt 22) { throw "Sauvegarde incomplète : $dataEntries entrées de données pour $tables tables." }
Write-Host "Sauvegarde ÉCRITE (non encore vérifiée). Étape suivante :"
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\db\verify-backup.ps1 -BackupDir `"$dir`""
