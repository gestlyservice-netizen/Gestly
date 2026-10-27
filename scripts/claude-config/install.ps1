<#
.SYNOPSIS
  Installe la configuration Claude Code v3 (administration Vercel) de Gestly.
  À LANCER PAR L'UTILISATEUR : Claude Code ne peut pas modifier ses propres garde-fous.

.DESCRIPTION
  1. Vérifie que les tests de la proposition passent.
  2. Affiche les différences avec la configuration installée.
  3. Demande confirmation (sauf -Oui), puis copie :
       scripts/claude-config/settings.json  → .claude/settings.json
       scripts/claude-config/guard.mjs      → .claude/hooks/guard.mjs
       scripts/claude-config/guard.proposal.test.ts → tests/claude-guard.test.ts (import adapté)
  4. Supprime scripts/claude-config/ (la version installée devient la seule référence).
  5. Lance les tests du garde-fou installé.
  Retour arrière : git checkout HEAD -- .claude tests/claude-guard.test.ts scripts/claude-config
#>
param([switch]$Oui)
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repo
$src = Join-Path $repo "scripts\claude-config"

npx vitest run scripts/claude-config/guard.proposal.test.ts
if ($LASTEXITCODE -ne 0) { throw "Les tests de la proposition échouent : installation annulée." }

git --no-pager diff --no-index --stat -- .claude/settings.json scripts/claude-config/settings.json
git --no-pager diff --no-index --stat -- .claude/hooks/guard.mjs scripts/claude-config/guard.mjs
if (-not $Oui) {
  $answer = Read-Host "Installer la configuration Claude Code v3 ? (oui/non)"
  if ($answer -ne "oui") { Write-Host "Installation annulée."; exit 1 }
}

Copy-Item (Join-Path $src "settings.json") (Join-Path $repo ".claude\settings.json") -Force
Copy-Item (Join-Path $src "guard.mjs") (Join-Path $repo ".claude\hooks\guard.mjs") -Force
$test = [IO.File]::ReadAllText((Join-Path $src "guard.proposal.test.ts"), [Text.Encoding]::UTF8)
$test = $test.Replace('from "./guard.mjs"', 'from "../.claude/hooks/guard.mjs"')
[IO.File]::WriteAllText((Join-Path $repo "tests\claude-guard.test.ts"), $test, (New-Object Text.UTF8Encoding $false))
Remove-Item -Recurse -Force $src

npx vitest run tests/claude-guard.test.ts
if ($LASTEXITCODE -ne 0) { throw "Les tests du garde-fou installé échouent : revenir en arrière (voir l'en-tête du script)." }
Write-Host "Configuration v3 installée. Relancer Claude Code pour recharger settings.json, puis committer :"
Write-Host "  git add .claude tests/claude-guard.test.ts scripts/claude-config && git commit -m `"chore: garde-fou Claude Code v3 (administration Vercel)`""
