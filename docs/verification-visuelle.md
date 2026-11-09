# Vérification visuelle des emails et des PDF

Contrôle à l'œil de ce que le client reçoit : emails (HTML et texte) et PDF joints. Il complète les tests automatisés, qui vérifient le **contenu** (montants, dates, mentions) mais pas le **rendu**.

Tout se fait en local, avec des données fictives : aucune base partagée, aucun envoi, aucune requête vers Internet.

## 1. Produire les documents (recette locale, 1 minute)

```powershell
.\scripts\recette\m15-email-local.ps1 -OutDir "$env:TEMP\gestly-apercu"
```

Le script crée un PostgreSQL 17 temporaire (`localhost:54330`), exécute la recette (envois simulés, serveur en UTC comme Vercel), puis supprime le serveur. Les documents sont écrits dans le dossier indiqué :

| Fichier | Contenu |
|---|---|
| `devis-email.html` / `.txt` | Email du devis (HTML et version texte) |
| `devis-joint.pdf` | PDF joint au devis |
| `devis-minuit.pdf` | Devis créé à 0 h 30 (heure de Paris) |
| `facture-email.txt` | Email de la facture (objet, destinataire, réponse, texte) |
| `facture-jointe.pdf` | PDF joint à la facture |
| `avoir.pdf` | PDF d'avoir |
| `relance-email.txt` | Relance J1 (objet, destinataire, réponse, texte) |
| `recette-m15.md`, `recette-rate-limit.md` | Résultats détaillés de la recette |

## 2. Captures et planche de contrôle

```powershell
.\scripts\recette\apercu-visuel.ps1 -Dir "$env:TEMP\gestly-apercu"
```

- Capture chaque email HTML avec Microsoft Edge sans interface : vue **ordinateur** (1280 px) et vue **téléphone**. Profil Edge temporaire, résolution DNS coupée.
- La vue téléphone affiche l'email dans un cadre de **390 px réels**. Une simple fenêtre de 390 px ne suffit pas : sous Windows, Edge sans interface impose une largeur minimale d'environ 492 px (mesurée) et rognerait l'image au lieu de réduire la page.
- Génère `planche.html` (captures, emails texte, PDF intégrés, points à contrôler) et l'ouvre dans le navigateur. Edge sans interface n'affiche pas les PDF : on les contrôle dans la planche.

## 3. Points à contrôler

Les mêmes points, à cocher, figurent dans la planche.

1. **Email HTML, ordinateur** : en-tête avec la raison sociale, montants HT, TVA et TTC alignés, bouton « Voir le devis en ligne », pied de page lisible.
2. **Email HTML, téléphone** : aucun débordement horizontal, montants sur une seule ligne, total TTC visible en entier.
3. **Données saisies** : aucune balise interprétée (« `<b>` » affiché tel quel dans les notes).
4. **Emails texte** : objet avec la raison sociale (jamais « Gestly »), montant, « à régler au plus tard le … » si l'échéance est postérieure, signature.
5. **PDF devis** : numéro, dates (jour de Paris), quantités (« 1,5 »), totaux 50,30 / 5,06 / 55,36, mentions légales en pied de page, rien de tronqué.
6. **PDF facture** : « Date d'échéance du paiement : … », jamais « à réception » si l'échéance est postérieure ; escompte, pénalités et indemnité de 40 euros présents.
7. **PDF avoir** : numéro, facture d'origine, motif, montants.
8. **PDF « minuit »** : daté du 04/11/2026, valable jusqu'au 04/12/2026.

## 4. Limites

- Le rendu dans Gmail, Outlook ou Apple Mail peut différer : certaines messageries ignorent `<style>`. Le gabarit reste lisible sans lui (largeurs en pourcentage). Seul un envoi réel vers des boîtes de test le vérifie (étape 3, accord requis).
- Les PDF sont générés par jsPDF avec les polices standard. Le contrôle visuel des PDF reste manuel (pas d'outil de rendu PDF installé sur le poste).
