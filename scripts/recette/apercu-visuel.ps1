<#
.SYNOPSIS
  Vérification visuelle des emails et PDF produits par la recette locale
  (scripts/recette/m15-email-local.ps1 -OutDir <dossier>).

.DESCRIPTION
  1. Capture chaque email HTML (*.html, hors planche) avec Microsoft Edge sans
     interface, en largeur ordinateur (1280 px) et téléphone (390 px) :
     <nom>-ordinateur.png, <nom>-telephone.png.
     Profil Edge temporaire (supprimé ensuite) et résolution DNS coupée
     (--host-resolver-rules) : aucune requête ne sort de la machine.
  2. Écrit planche.html : captures, emails texte (*.txt) et PDF (*.pdf)
     intégrés, avec la liste des points à contrôler. Edge sans interface
     n'affiche pas les PDF : ils se contrôlent à l'œil dans cette planche.
  3. Ouvre la planche dans le navigateur par défaut (sauf -NoOpen).

  Données 100 % fictives (recette). Aucun envoi, aucune base.

.PARAMETER Dir
  Dossier des artefacts de la recette.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dir,
  [switch]$NoOpen
)
$ErrorActionPreference = "Stop"
$Dir = (Resolve-Path $Dir).Path

$edge = @(
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function Save-Screenshot([string]$file, [string]$png, [int]$width, [int]$height, [string]$profile) {
  $uri = ([Uri]$file).AbsoluteUri
  $proc = Start-Process -FilePath $edge -PassThru -WindowStyle Hidden -ArgumentList @(
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=`"$profile`"", "--host-resolver-rules=`"MAP * ~NOTFOUND`"",
    "--hide-scrollbars", "--window-size=$width,$height", "--screenshot=`"$png`"", $uri)
  $null = $proc.Handle
  if (-not $proc.WaitForExit(60000)) { $proc.Kill(); throw "Capture trop longue : $file" }
  if (-not (Test-Path $png)) { throw "Capture absente : $png" }
}

$emails = Get-ChildItem $Dir -Filter *.html | Where-Object { $_.Name -ne "planche.html" }
$shots = @()
if ($edge) {
  $profile = Join-Path $env:TEMP ("gestly-edge-" + [guid]::NewGuid())
  try {
    foreach ($e in $emails) {
      # Ordinateur : fenêtre de 1280 px.
      $png = Join-Path $Dir ("{0}-ordinateur.png" -f $e.BaseName)
      Save-Screenshot $e.FullName $png 1280 1500 $profile
      $shots += [pscustomobject]@{ Email = $e.Name; Vue = "ordinateur"; Png = (Split-Path $png -Leaf); Largeur = 1280 }
      Write-Host "OK    Capture $($e.Name) (ordinateur, 1280 px)"
      # Téléphone : Edge sans interface impose une fenêtre d'au moins ~492 px
      # sous Windows (mesuré) ; une fenêtre « 390 px » serait rognée, pas
      # réduite. L'email est donc affiché dans un cadre de 390 px réels, qui
      # est sa vraie largeur d'affichage (media queries comprises).
      $wrapper = Join-Path $Dir ("_{0}-telephone.html" -f $e.BaseName)
      [IO.File]::WriteAllText($wrapper, "<!doctype html><body style=""margin:0;background:#fff""><iframe src=""$($e.Name)"" style=""width:390px;height:1800px;border:0;display:block""></iframe></body>", (New-Object Text.UTF8Encoding $true))
      $png = Join-Path $Dir ("{0}-telephone.png" -f $e.BaseName)
      try { Save-Screenshot $wrapper $png 500 1800 $profile } finally { Remove-Item -Force $wrapper -ErrorAction SilentlyContinue }
      $shots += [pscustomobject]@{ Email = $e.Name; Vue = "telephone"; Png = (Split-Path $png -Leaf); Largeur = 500 }
      Write-Host "OK    Capture $($e.Name) (téléphone, cadre de 390 px)"
    }
  } finally {
    Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "Edge introuvable : captures ignorées, planche générée sans captures."
}

function Esc([string]$s) { [System.Net.WebUtility]::HtmlEncode($s) }
$sections = @()
foreach ($s in $shots) {
  $sections += "<figure><figcaption>$(Esc $s.Email) — $($s.Vue) ($($s.Largeur) px)</figcaption><img src=""$(Esc $s.Png)"" style=""max-width:$($s.Largeur)px""></figure>"
}
foreach ($t in Get-ChildItem $Dir -Filter *.txt) {
  $sections += "<figure><figcaption>$(Esc $t.Name) (email texte)</figcaption><pre>$(Esc ([IO.File]::ReadAllText($t.FullName, [Text.Encoding]::UTF8)))</pre></figure>"
}
foreach ($p in Get-ChildItem $Dir -Filter *.pdf) {
  $sections += "<figure><figcaption>$(Esc $p.Name)</figcaption><iframe src=""$(Esc $p.Name)"" title=""$(Esc $p.Name)""></iframe></figure>"
}

$checklist = @(
  "Email HTML, ordinateur : en-tête avec la raison sociale, montants HT / TVA / TTC alignés, bouton « Voir le devis en ligne », pied de page lisible.",
  "Email HTML, téléphone (390 px) : aucun débordement horizontal, total TTC entièrement visible, texte lisible sans zoom.",
  "Données saisies : aucune balise interprétée (ex. « <b> » affiché tel quel dans les notes).",
  "Emails texte : objet avec la raison sociale (jamais « Gestly »), montant, échéance « à régler au plus tard le … », signature.",
  "PDF devis : numéro, dates (jour de Paris), lignes (quantité « 1,5 »), totaux 50,30 / 5,06 / 55,36, mentions légales en pied de page, rien de tronqué.",
  "PDF facture : « Date d'échéance du paiement : … », jamais « à réception » si l'échéance est postérieure ; escompte, pénalités et 40 euros présents.",
  "PDF avoir : numéro, facture d'origine, motif, montants.",
  "PDF « minuit » : daté du 04/11/2026, valable jusqu'au 04/12/2026."
)
$items = ($checklist | ForEach-Object { "<li><label><input type=""checkbox""> $(Esc $_)</label></li>" }) -join "`n"

$html = @"
<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Planche de vérification visuelle</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0 auto; max-width: 1400px; padding: 16px; background: #f8fafc; color: #0f172a; }
  figure { margin: 24px 0; padding: 12px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow-x: auto; }
  figcaption { font-weight: 600; margin-bottom: 8px; }
  img { border: 1px solid #cbd5e1; display: block; width: 100%; height: auto; }
  pre { white-space: pre-wrap; font-size: 14px; }
  iframe { width: 100%; height: 900px; border: 1px solid #cbd5e1; }
  li { margin: 6px 0; }
</style></head>
<body>
<h1>Planche de vérification visuelle — données fictives</h1>
<p>Dossier : $(Esc $Dir) — générée le $(Get-Date -Format "dd/MM/yyyy HH:mm").</p>
<h2>Points à contrôler</h2>
<ol>
$items
</ol>
$($sections -join "`n")
</body></html>
"@
$planche = Join-Path $Dir "planche.html"
[IO.File]::WriteAllText($planche, $html, (New-Object Text.UTF8Encoding $true))
Write-Host "OK    Planche : $planche"
if (-not $NoOpen) { Start-Process $planche }
