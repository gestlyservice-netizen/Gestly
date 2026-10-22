<#
.SYNOPSIS
  Installe la configuration Claude Code v2 (permissions + garde-fou) de Gestly.
  À LANCER PAR L'UTILISATEUR : Claude Code ne peut pas modifier ses propres garde-fous.

.DESCRIPTION
  1. Affiche les différences avec la configuration installée.
  2. Demande confirmation, puis copie :
       scripts/claude-config/settings.json  → .claude/settings.json
       scripts/claude-config/guard.mjs      → .claude/hooks/guard.mjs
       scripts/claude-config/guard.proposal.test.ts → tests/claude-guard.test.ts (import adapté)
  3. Supprime scripts/claude-config/ (la version installée devient la seule référence).
  4. Lance les tests du garde-fou installé.
  Retour arrière : git checkout HEAD -- .claude tests/claude-guard.test.ts scripts/claude-config
#>
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repo
$src = Join-Path $repo "scripts\claude-config"

git --no-pager diff --no-index --stat -- .claude/settings.json scripts/claude-config/settings.json
git --no-pager diff --no-index --stat -- .claude/hooks/guard.mjs scripts/claude-config/guard.mjs
$answer = Read-Host "Installer la configuration Claude Code v2 ? (oui/non)"
if ($answer -ne "oui") { Write-Host "Installation annulée."; exit 1 }

Copy-Item (Join-Path $src "settings.json") (Join-Path $repo ".claude\settings.json") -Force
Copy-Item (Join-Path $src "guard.mjs") (Join-Path $repo ".claude\hooks\guard.mjs") -Force
$test = [IO.File]::ReadAllText((Join-Path $src "guard.proposal.test.ts"), [Text.Encoding]::UTF8)
$test = $test.Replace('from "./guard.mjs"', 'from "../.claude/hooks/guard.mjs"')
[IO.File]::WriteAllText((Join-Path $repo "tests\claude-guard.test.ts"), $test, (New-Object Text.UTF8Encoding $false))
Remove-Item -Recurse -Force $src

npx vitest run tests/claude-guard.test.ts
if ($LASTEXITCODE -ne 0) { throw "Les tests du garde-fou installé échouent : revenir en arrière (voir l'en-tête du script)." }
Write-Host "Configuration v2 installée. Relancer Claude Code (ou /hooks) pour recharger les réglages, puis committer :"
Write-Host "  git add .claude tests/claude-guard.test.ts scripts/claude-config && git commit -m `"chore: garde-fou Claude Code v2`""
