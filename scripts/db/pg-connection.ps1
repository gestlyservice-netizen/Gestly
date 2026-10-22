# Connexion PostgreSQL pour les scripts de sauvegarde — à charger par
# dot-sourcing (. "$PSScriptRoot\pg-connection.ps1"). Ne rien afficher ici
# qui contienne l'hôte complet, l'utilisateur ou le mot de passe.
#
# Get-GestlyDatabaseUrl : URI de la base, dans cet ordre :
#   1. $env:GESTLY_DB_URL (saisie explicite pour cette session) ;
#   2. DATABASE_URL de .env.local, puis de .env (configuration existante
#      de l'application) ;
#   3. saisie masquée.
# ConvertTo-PgConnection : décompose l'URI en variables libpq (PGHOST,
#   PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE). Le mot de passe ne
#   passe donc jamais en argument de ligne de commande (visible dans la
#   liste des processus). Les paramètres propres à Prisma (pgbouncer,
#   connection_limit…), refusés par libpq, sont ignorés. Le pooler Supabase
#   en mode transaction (port 6543), incompatible avec pg_dump, est remplacé
#   par le mode session (port 5432) du même pooler.

function Get-GestlyDatabaseUrl([string]$RepoRoot) {
  if ($env:GESTLY_DB_URL) { return @{ Url = $env:GESTLY_DB_URL; Source = "variable GESTLY_DB_URL" } }
  foreach ($name in ".env.local", ".env") {
    $file = Join-Path $RepoRoot $name
    if (-not (Test-Path $file)) { continue }
    foreach ($line in [IO.File]::ReadAllLines($file)) {
      if ($line -match '^\s*(export\s+)?DATABASE_URL\s*=\s*(.*)$') {
        $value = $Matches[2].Trim()
        if ($value -match '^"(.*)"\s*(#.*)?$' -or $value -match "^'(.*)'\s*(#.*)?$") { $value = $Matches[1] }
        elseif ($value -match '^([^#\s]*)') { $value = $Matches[1] }
        if ($value) { return @{ Url = $value; Source = "DATABASE_URL de $name" } }
      }
    }
  }
  $secure = Read-Host "URI de connexion Supabase (saisie masquée)" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  return @{ Url = $plain; Source = "saisie masquée" }
}

function ConvertTo-PgConnection([string]$Url) {
  if ($Url -notmatch '^postgres(ql)?://') { throw "URI de connexion invalide (doit commencer par postgresql://)." }
  try { $u = [Uri]$Url } catch { throw "URI de connexion illisible (caractère spécial non encodé dans le mot de passe ?)." }
  $userInfo = $u.UserInfo -split ':', 2
  if ($userInfo.Count -lt 2 -or -not $userInfo[1]) { throw "Mot de passe absent de l'URI de connexion." }
  $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  $isPooler = $u.Host -like "*.pooler.supabase.com"
  $isDirect = $u.Host -like "db.*.supabase.co"
  $notes = @()
  if ($isPooler -and $port -eq 6543) { $port = 5432; $notes += "pooler Supabase en mode transaction (6543) remplacé par le mode session (5432)" }
  $ignored = @()
  if ($u.Query) {
    $ignored = $u.Query.TrimStart('?').Split('&') | ForEach-Object { ($_ -split '=', 2)[0] } | Where-Object { $_ -and $_ -ne 'sslmode' }
  }
  $db = $u.AbsolutePath.TrimStart('/')
  $user = [Uri]::UnescapeDataString($userInfo[0])
  return [pscustomobject]@{
    Env = [ordered]@{
      PGHOST = $u.Host; PGPORT = "$port"; PGUSER = $user
      PGPASSWORD = [Uri]::UnescapeDataString($userInfo[1])
      PGDATABASE = $(if ($db) { [Uri]::UnescapeDataString($db) } else { "postgres" })
      PGSSLMODE = "require"; PGAPPNAME = "gestly-backup"; PGCONNECT_TIMEOUT = "15"
    }
    # Diagnostic sans secret : nature de l'hôte, port, format de l'utilisateur.
    Kind = $(if ($isPooler) { "pooler Supabase" } elseif ($isDirect) { "connexion directe Supabase (IPv6 uniquement sur l'offre gratuite)" } else { "hôte non Supabase" })
    Port = $port
    PoolerUserFormat = ($user -like "postgres.*")
    Ignored = @($ignored)
    Notes = $notes
  }
}

function Set-PgEnvironment($Connection) {
  foreach ($k in $Connection.Env.Keys) { Set-Item "Env:$k" $Connection.Env[$k] }
}

function Clear-PgEnvironment {
  foreach ($k in "PGHOST", "PGPORT", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE", "PGAPPNAME", "PGCONNECT_TIMEOUT") {
    Remove-Item "Env:$k" -ErrorAction SilentlyContinue
  }
}
