# Recette fonctionnelle Gestly V1 — www.gestly.fr (bêta privée)

Préparée le 2026-10-27, après le déploiement `e529cfd` (`dpl_EnZcY9BYN722iwD5gA5h6dCaQRGb`). Durée : 90 à 120 minutes.

## Règles
- **Données fictives uniquement** : clients, emails et téléphones inventés (`client.test@example.com`, `+33 6 00 00 00 01`). La base est partagée avec le développement.
- **Paiement** : Stripe en mode test, carte `4242 4242 4242 4242`, date future, CVC quelconque. Carte refusée : `4000 0000 0000 0341`.
- **Envois** : `OUTBOUND_MODE=simulate`. Tout bouton « Envoyer » doit afficher « Bêta privée : l'envoi automatique… est désactivé » : **c'est le résultat attendu**, pas un défaut.
- Deux comptes : **A** (principal) et **B** (contrôle d'isolement), avec deux adresses email que vous contrôlez (alias `+a`/`+b` possibles). L'email de vérification vient de Clerk, pas de Gestly.
- Noter chaque écart : numéro du test, heure, URL, capture. Me transmettre la liste : je corrige et je redéploie (avec votre accord).

## 1. Accès et abonnement (15 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 1.1 | Fenêtre privée → `www.gestly.fr` ; ouvrir CGU, CGV, confidentialité, mentions légales, remboursement, contact | Pages affichées, aucune erreur | |
| 1.2 | Ouvrir `www.gestly.fr/dashboard` sans être connecté | Redirection vers la connexion | |
| 1.3 | Créer le compte A | Arrivée sur `/abonnement` | |
| 1.4 | Payer sans cocher CGU/CGV | Paiement impossible | |
| 1.5 | Cocher, payer avec `4000 0000 0000 0341` | Refus affiché par Stripe, aucun accès | |
| 1.6 | Payer avec `4242…` | Retour direct au dashboard ; Paramètres → Abonnement : « Essai gratuit », fin à J+14 | |
| 1.7 | Revenir sur `/abonnement` | Pas de second paiement possible (« Accéder au dashboard ») | |
| 1.8 | Paramètres → Abonnement → « Gérer » | Portail Stripe (mode test) ; retour à Gestly | |

## 2. Paramètres de l'entreprise (10 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 2.1 | Raison sociale, SIRET, adresse, TVA, IBAN, conditions de paiement, pénalités, réserve de propriété | Enregistré après rechargement | |
| 2.2 | Logo (PNG < 1 Mo) | Logo affiché, ou « Upload non configuré » (stockage non requis en bêta) | |
| 2.3 | Section numérotation | « Prochain n° » affiché pour devis, factures, avoirs | |
| 2.4 | Paramètres → Relances : modifier les délais | Enregistré (les relances ne partiront pas en bêta) | |

## 3. Clients (5 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 3.1 | Créer 2 clients fictifs (un particulier, une entreprise) | Visibles dans la liste | |
| 3.2 | Modifier un client, rechercher par nom | Modification conservée, recherche correcte | |
| 3.3 | Formulaire invalide (email incorrect, nom vide) | Message d'erreur, rien de créé | |

## 4. Devis (20 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 4.1 | Nouveau devis : client 1, 3 lignes (quantités décimales, TVA différentes), remise si disponible | Numéro `DEV-2026-…` ; totaux HT/TVA/TTC justes (vérifier à la main) | |
| 4.2 | Modifier une ligne du brouillon | Totaux recalculés | |
| 4.3 | Télécharger le PDF | Logo, coordonnées, SIRET, mentions des Paramètres, toutes les lignes ; pagination correcte si long | |
| 4.4 | Bouton « Améliorer le message » (IA), s'il est visible | Message « Fonctionnalité IA non configurée » : attendu en bêta | |
| 4.5 | « Envoyer » par email | Message « Bêta privée… désactivé » ; le devis **n'est pas** marqué envoyé | |
| 4.6 | « Envoyer » par WhatsApp | Même message, aucun envoi | |
| 4.7 | Copier le lien public ; l'ouvrir dans une autre fenêtre privée (déconnectée) | Le devis s'affiche ; aucune donnée de compte (email personnel, identifiants) | |
| 4.8 | Dupliquer le devis | Nouveau numéro, mêmes lignes | |
| 4.9 | Passer le devis en signé, puis tenter de le modifier ou supprimer | Modification et suppression refusées avec un message | |
| 4.10 | Supprimer le devis dupliqué (brouillon) | Supprimé ; le numéro suivant n'est pas réutilisé à tort | |

## 5. Factures et avoirs (20 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 5.1 | Devis signé → « Transformer en facture » | Facture `FAC-2026-…`, lignes identiques | |
| 5.2 | Retransformer le même devis | Refus « Ce devis a déjà été transformé en facture » | |
| 5.3 | Facture directe (Factures → Nouveau) pour le client 2 | Numéro suivant, sans trou | |
| 5.4 | PDF facture | Échéance, pénalités de retard, indemnité forfaitaire 40 €, escompte, mentions légales | |
| 5.5 | « Envoyer » la facture | Message « Bêta privée… », non marquée envoyée | |
| 5.6 | Chercher une suppression ou une modification de la facture émise | Impossible (correction par avoir uniquement) | |
| 5.7 | Avoir partiel sans motif, puis avec motif et montant | Refus sans motif ; avec motif : `AV-2026-…`, lié à la facture | |
| 5.8 | PDF de l'avoir | Référence de la facture d'origine, montants négatifs ou crédités | |
| 5.9 | Marquer la facture 5.3 payée | Statut « payée », tableau de bord mis à jour | |
| 5.10 | Page Relances d'une facture impayée | Historique vide (relances suspendues en bêta), aucune erreur | |

## 6. Agenda, pipeline, notifications, tableau de bord (10 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 6.1 | Agenda : créer, déplacer, modifier, supprimer un événement | Chaque action conservée après rechargement | |
| 6.2 | Pipeline : créer une opportunité, la changer d'étape | Conservé après rechargement | |
| 6.3 | Cloche de notifications | S'ouvre, « tout marquer comme lu » fonctionne | |
| 6.4 | Tableau de bord | Chiffres cohérents avec les factures et devis créés | |

## 7. Sécurité et isolement (10 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 7.1 | Compte B (nouvelle fenêtre privée, abonnement test) | Aucun client, devis ni facture de A | |
| 7.2 | Avec B, ouvrir l'URL d'un devis et d'une facture de A (`/dashboard/devis/<id>`, `/print/factures/<id>`) | Introuvable / non autorisé, aucune donnée de A | |
| 7.3 | Numérotation de B | Commence à son propre premier numéro, indépendant de A | |

## 8. Fin d'abonnement (10 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 8.1 | Compte B : portail Stripe → annuler immédiatement (ou Stripe test → annuler l'abonnement) | Accès au dashboard bloqué → `/abonnement` « Abonnement suspendu » | |
| 8.2 | Réabonner B avec `4242…` | Paiement **sans** nouvel essai gratuit ; accès rétabli | |

## 9. Mobile (10 min)
| # | Étapes | Attendu | OK/KO |
|---|---|---|---|
| 9.1 | Téléphone : connexion A, menu, liste des devis, création d'un devis, PDF | Utilisable, aucun débordement bloquant | |

## Hors périmètre de la bêta (désactivé volontairement)
Envois email, SMS et WhatsApp ; relances automatiques ; agent IA WhatsApp ; amélioration de texte par IA. Ils seront recettés à l'ouverture commerciale (`OUTBOUND_MODE=live`, décision de l'utilisateur).

## Critère de sortie
Tous les tests OK, ou écarts mineurs acceptés par écrit. Puis : inviter les bêta-testeurs (données fictives ou réelles selon votre décision ; la base n'est pas encore une base de production dédiée et sauvegardée automatiquement — voir `docs/beta-privee.md`, section 4).
