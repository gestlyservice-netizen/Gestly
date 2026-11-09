<#
.SYNOPSIS
  Recette M15 (envoi des devis et factures par email) sur une base PostgreSQL
  LOCALE et TEMPORAIRE, envois en simulation.

.DESCRIPTION
  1. Crée un serveur PostgreSQL 17 temporaire (initdb dans %TEMP%, port 54330,
     écoute sur localhost uniquement, authentification « trust » locale).
  2. Crée le schéma à partir de prisma/schema.prisma
     (`prisma migrate diff --from-empty --to-schema --script`, aucune
     connexion à une base distante) et l'applique avec psql sur localhost.
  3. Lance tests/recette/m15-email.recette.ts (vitest.recette.config.ts) :
     vraies routes API, vrai Prisma sur cette base locale, serveur simulé en
     UTC (comme Vercel), envois en simulation, tout appel réseau interdit.
  4. Arrête le serveur et supprime ses données (sauf -Keep).

  Aucune lecture de .env*, aucune connexion à Supabase, aucun envoi réel :
  la recette refuse de démarrer si l'URL de base n'est pas locale.

.PARAMETER OutDir
  Dossier des artefacts (emails HTML/texte, PDF joints, résultats JSON).

.PARAMETER Keep
  Conserve le serveur temporaire arrêté et ses données (diagnostic).
#>
param(
  [string]$OutDir = (Join-Path $env:TEMP ("gestly-recette-m15-" + (Get-Date -Format "yyyyMMddHHmmss"))),
  [switch]$Keep
)
$ErrorActionPreference = "Stop"
$port = 54330
$dbName = "gestly_recette"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")

function Find-PgTool([string]$name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidate = "C:\Program Files\PostgreSQL\17\bin\$name.exe"
  if (Test-Path $candidate) { return $candidate }
  throw "$name introuvable : installer PostgreSQL 17 (winget install --id PostgreSQL.PostgreSQL.17 -e)."
}
$initdb = Find-PgTool "initdb"; $pgCtl = Find-PgTool "pg_ctl"
$psql = Find-PgTool "psql"; $createdb = Find-PgTool "createdb"
$local = "postgresql://postgres@localhost:$port/$dbName"

$data = Join-Path $env:TEMP ("gestly-recette-pg-" + (Get-Date -Format "yyyyMMddHHmmss"))
$schemaSql = "$data-schema.sql"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$started = $false
$exitCode = 1
try {
  # 1. Serveur temporaire, localhost uniquement.
  & $initdb -D $data -U postgres -A trust -E UTF8 --no-locale | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "initdb a échoué." }
  # Sous Windows, le serveur lancé par pg_ctl hérite des canaux de sortie : on
  # attend pg_ctl seul, sortie redirigée vers un fichier (cf. verify-backup.ps1).
  $proc = Start-Process -FilePath $pgCtl -NoNewWindow -PassThru -RedirectStandardOutput "$data-pg_ctl.txt" `
    -ArgumentList "-D `"$data`" -o `"-p $port -c listen_addresses=localhost`" -l `"$data\server.log`" -w -t 60 start"
  $null = $proc.Handle
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { throw "Démarrage du serveur temporaire impossible (port $port occupé ? voir $data\server.log)." }
  $started = $true
  & $createdb -h localhost -p $port -U postgres $dbName
  if ($LASTEXITCODE -ne 0) { throw "createdb a échoué." }
  Write-Host "OK    Serveur PostgreSQL temporaire : localhost:$port/$dbName"

  # 2. Schéma généré depuis schema.prisma (diff hors ligne), appliqué en local.
  # PowerShell 5.1 transforme toute sortie d'erreur d'un exécutable en
  # exception quand ErrorActionPreference vaut Stop : cmd.exe redirige ici
  # stdout (SQL) et stderr (bannière Prisma) vers des fichiers.
  Push-Location $root
  try {
    cmd /c "npx.cmd prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > `"$schemaSql`" 2> `"$data-diff.txt`""
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate diff a échoué (voir $data-diff.txt)." }
  } finally { Pop-Location }
  # Les NOTICE de psql (stderr) deviendraient des exceptions : avertissements seulement.
  $env:PGOPTIONS = "-c client_min_messages=warning"
  & $psql -X -q -v ON_ERROR_STOP=1 -d $local -f $schemaSql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Application du schéma en échec." }
  $tables = & $psql -X -A -t -d $local -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"
  Write-Host "OK    Schéma appliqué ($($tables.Trim()) tables)"

  # 3. Recette : serveur simulé en UTC (Vercel), aucune autre variable.
  $env:GESTLY_RECETTE_PG = $local
  $env:GESTLY_RECETTE_OUT = $OutDir
  $env:TZ = "UTC"
  Push-Location $root
  $previous = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & npx.cmd vitest run --config vitest.recette.config.ts 2>&1 | ForEach-Object { "$_" }
    $exitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = $previous; Pop-Location }
  Write-Host "Artefacts : $OutDir"
} finally {
  Remove-Item Env:GESTLY_RECETTE_PG, Env:GESTLY_RECETTE_OUT, Env:TZ, Env:PGOPTIONS -ErrorAction SilentlyContinue
  if ($started) { & $pgCtl -D $data -m fast -w stop | Out-Null }
  if (-not $Keep) {
    Remove-Item -Recurse -Force $data -ErrorAction SilentlyContinue
    Remove-Item -Force "$data-pg_ctl.txt", "$data-diff.txt", $schemaSql -ErrorAction SilentlyContinue
    Write-Host "OK    Serveur temporaire arrêté et supprimé"
  } else {
    Write-Host "Serveur conservé (arrêté) : $data"
  }
}
exit $exitCode
