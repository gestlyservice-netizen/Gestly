# Bêta privée — mise en ligne et recette

Préparé le 2026-10-27 (branche `test/whatsapp-flow`). Aucune valeur de secret dans ce fichier.

## 1. Configuration Vercel (Production) — à vérifier par l'utilisateur

Vercel → projet Gestly → Settings → Environment Variables → **Production**.

| Variable | Bêta privée | Contrôle sans afficher la valeur |
|---|---|---|
| `OUTBOUND_MODE` | **`simulate`** (à ajouter) | Les envois de devis, factures et relances sont refusés avec un message « Bêta privée » ; rien n'est marqué envoyé |
| `DATABASE_URL` | Projet Supabase `ixaxfhitplhynhpihojx` | L'hôte contient `ixaxfhitplhynhpihojx` ; pooler (port 6543) recommandé sur Vercel |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Instance Clerk de **production** recommandée (`pk_live_`/`sk_live_`) | Avec l'instance de dev (`pk_test_`), les comptes bêta devront être migrés à l'ouverture (autre `clerkId`) |
| `STRIPE_SECRET_KEY` | Mode **test** (`sk_test_`) : les bêta-testeurs ne paient rien (carte 4242 4242 4242 4242) | Préfixe `sk_test_` |
| `STRIPE_PRICE_ID` | Prix **du mode test** | Préfixe `price_`, visible dans Stripe en mode test |
| `STRIPE_WEBHOOK_SECRET` | Secret de l'endpoint de test ci-dessous | Préfixe `whsec_` |
| `CRON_SECRET` | Chaîne aléatoire longue | Sans elle, les crons Vercel sont refusés (401) : la resynchronisation Stripe ne tourne pas |
| `APP_URL` | `https://www.gestly.fr` | — |
| `NEXT_PUBLIC_SENTRY_DSN` (+ `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`) | Recommandé | — |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Facultatif (upload du logo) | Sans elles : « Upload non configuré » |
| Resend, OVH, WhatsApp, IA | **Inutiles en bêta** (bloquées par `OUTBOUND_MODE=simulate`) | Ne pas configurer le webhook Meta |

**Stripe (mode test)** → Développeurs → Webhooks → endpoint `https://www.gestly.fr/api/stripe/webhook`, événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`. Version d'API de l'endpoint : 2025-03-31 ou plus récente (sinon les événements `invoice.*` sont ignorés ; `customer.subscription.*` suffisent à synchroniser).
**Stripe (mode test)** → Paramètres → Portail client : activer la mise à jour du moyen de paiement et la résiliation.

## 2. Déploiement (utilisateur)

```powershell
git checkout main
git merge --ff-only test/whatsapp-flow   # avance rapide : main est un ancêtre de la branche
git push origin main                      # Vercel déploie la production automatiquement
git checkout test/whatsapp-flow
```

Puis, **juste après** le déploiement (fige les lignes des factures créées entre-temps ; sans effet s'il n'y en a pas) :

```powershell
.\scripts\db\apply-migrations.ps1 -BackupDir "$HOME\gestly-backups\20261022-220318" -RefreezeOnly
```

Contrôle dans le navigateur : `https://www.gestly.fr/api/health` → HTTP 200, `checks.outbound` = `mode=simulate`, `DATABASE_URL` = `set (host: …ixaxfhitplhynhpihojx…, port: 6543 …)`, Clerk et la base sans `MISSING` ni `FAILED`. Aucune valeur secrète n'y est affichée.

Retour arrière : Vercel → Deployments → déploiement précédent → « Promote to Production ». La base reste compatible (le schéma n'a pas changé depuis les migrations du 2026-10-23).

## 3. Recette réelle (60 minutes)

Compte de test neuf, adresse email fictive ou alias personnel, aucun vrai client.

| Min | Étape | Attendu |
|---|---|---|
| 0–10 | Inscription sur `www.gestly.fr`, page `/abonnement`, cocher CGU/CGV, Checkout, carte `4242 4242 4242 4242` | Retour sur le dashboard sans attente ; Paramètres → Abonnement : « Essai gratuit », fin d'essai à J+14 |
| 10–15 | Revenir sur `/abonnement` et recliquer | « Accéder au dashboard », aucun second Checkout possible |
| 15–25 | Paramètres : entreprise, SIRET, adresse, conditions de paiement, réserve de propriété, logo (si stockage configuré) | Enregistré ; « Prochain n° » affiché |
| 25–35 | Client fictif, devis de 2 lignes, PDF, lien public dans une fenêtre privée | Numéro DEV-2026-xxx ; PDF avec mentions ; le lien public n'affiche que le devis |
| 35–40 | « Envoyer » le devis | Message « Bêta privée : l'envoi automatique est désactivé… » ; devis non marqué envoyé |
| 40–48 | Passer le devis en signé → Transformer en facture → PDF facture → Marquer payée → Avoir partiel | FAC-2026-xxx, mentions L.441-10, escompte ; avoir AV-2026-xxx ; suppression de la facture impossible |
| 48–55 | Agenda (1 événement), Pipeline (1 opportunité), Notifications | Créés et modifiables |
| 55–60 | Portail Stripe : résilier immédiatement (ou Stripe test → annuler l'abonnement) | Accès bloqué → `/abonnement` « Abonnement suspendu » ; réabonnement sans nouvel essai |

Noter tout écart avec l'heure et l'URL ; Sentry doit rester vide.

## 4. Passage à l'ouverture commerciale (plus tard)

- `OUTBOUND_MODE=live` + Resend (domaine vérifié), OVH, WhatsApp, IA selon l'offre.
- Stripe live : nouvelles clés, prix, webhook ; remettre à zéro `stripeCustomerId`/`stripeSubscriptionId` des comptes bêta (identifiants de test invalides en live).
- Clerk dev → prod si la bêta a utilisé l'instance de dev : rattacher les comptes par email.
- Base de production dédiée et sauvegardée (offre payante Supabase).
- Cron WhatsApp à `*/15 * * * *` (Vercel Pro) si l'agent est activé.
