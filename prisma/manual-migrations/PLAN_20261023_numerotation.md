# Plan d'application — numérotation et conservation des documents (2026-10-23)

> ⚠️ Aucune de ces migrations n'a été exécutée. À appliquer **uniquement** sur décision explicite de l'utilisateur, par lui-même (éditeur SQL Supabase) ou par Claude après autorisation écrite. Claude Code n'a pas le droit d'exécuter `apply_migration` (règle `deny` de `.claude/settings.json`).

## 1. Contexte et compatibilité

La base Supabase `ixaxfhitplhynhpihojx` sert **à la fois au développement et à la production** (`main`, déployée sur Vercel). Chaque migration a donc été vérifiée sur deux plans : compatibilité avec le code **actuellement déployé** et compatibilité avec la branche `test/whatsapp-flow`.

| Migration | Effet | Code déployé (`main`) | Branche `test/whatsapp-flow` |
|---|---|---|---|
| `20261023_document_number_counters` | Crée la table `DocumentNumberCounter` | Ignorée | Utilisée dès sa création (détection `to_regclass`) ; avant création, fonctionnement dégradé documenté |
| `20261022_unique_document_numbers` | Index uniques `(userId, number)` sur Devis, Facture, Avoir | Une création simultanée qui produirait un doublon (`count + 1`) échoue en 500 au lieu de créer un doublon silencieux | Aucun doublon possible (verrou), l'index est un filet de sécurité |
| `20261022_restrict_accounting_document_deletion` | `ON DELETE RESTRICT` : client → factures / avoirs, compte → factures / avoirs, facture → avoirs | Supprimer un client qui a des factures échoue en 500 au lieu d'effacer ses factures | Déjà refusé par l'application (409) |
| `20261023_freeze_invoice_lines` | Copie les lignes du devis dans les factures sans ligne propre | Les factures affichent leurs propres lignes (déjà géré par `GET /api/factures/[id]`) | Idem ; les nouvelles factures sont déjà émises avec leurs lignes |

**Ordre recommandé : migrations d'abord, puis fusion et déploiement de la branche.** Les deux ordres sont techniquement supportés, mais ce choix active immédiatement les garanties D1 et D4.

## 2. Avant toute exécution

1. **Sauvegarde.** Le plan gratuit Supabase n'offre pas de restauration à un instant donné. Faire un export (tableau de bord Supabase → Database → Backups, ou `pg_dump` lancé par l'utilisateur) au minimum des tables `Devis`, `DevisLine`, `Facture`, `FactureLine`, `Avoir`, `AvoirLine`, `Client`, `Settings`, `User`.
2. **Contrôle préalable**, en lecture seule : `20261022_document_numbers_precheck.sql`. Résultats attendus :
   - (1) `groupes_en_doublon` = 0 pour Devis, Facture et Avoir. **Sinon : STOP**, renuméroter les doublons avec l'utilisateur avant l'étape 4.
   - (2) Les 5 contraintes existent, `confdeltype = 'c'` et `confupdtype = 'c'`. Si un nom diffère : **STOP**, adapter le script.
   - (3) Toutes les colonnes valent `null` : objets à créer absents.
   - (4) Lister les factures sans ligne propre et vérifier, avec l'artisan, que le devis lié n'a pas été modifié après la facturation (la copie reprendra son contenu actuel).
   - (5) Nombre de comptes qui possèdent des factures ou avoirs : ils ne pourront plus être supprimés après l'étape 5.
3. **Créneau calme** : chaque migration prend brièvement un verrou exclusif sur les tables concernées (millisecondes sur ces volumes : 8 devis, 5 factures au 2026-10-22).

## 3. Application, dans l'ordre (chaque fichier = une transaction : un échec n'applique rien)

| Étape | Fichier | Risque | Contrôle après |
|---|---|---|---|
| 3 | `20261023_document_number_counters_up.sql` | Nul (création additive) | `select to_regclass('public."DocumentNumberCounter"')` non nul ; RLS activée |
| 4 | `20261022_unique_document_numbers_up.sql` | Échec si un doublon apparaît entre le contrôle et l'exécution (aucun effet, à relancer après correction) | Les 3 index existent : `to_regclass('public."Devis_userId_number_key"')` |
| 5 | `20261022_restrict_accounting_document_deletion_up.sql` | Échec si un nom de contrainte diffère (aucun effet). Ensuite, toute suppression de compte ou de client possédant des factures échoue : comportement voulu (D5) | `confdeltype = 'r'` pour les 5 contraintes |
| 6 | `20261023_freeze_invoice_lines_up.sql` | Fige le contenu actuel des devis liés (cf. contrôle 2.4) | `factures_sans_ligne_propre` = 0 ; nombre de lignes tracées dans `_Backfill20261023FactureLine` |

Si l'exécution passe par l'outil `apply_migration` de Supabase, la migration est enregistrée dans `supabase_migrations.schema_migrations` (comme les migrations de l'agent WhatsApp). Avec l'éditeur SQL, elle ne l'est pas : la consigner dans `PROGRESS.md`.

## 4. Validation fonctionnelle (après étape 6, en simulation d'envois)

1. Créer un devis web, puis un devis via le parcours WhatsApp simulé : numéros consécutifs `DEV-AAAA-NNN`, compteurs créés.
2. Supprimer le dernier devis brouillon, puis en créer un autre : le numéro supprimé n'est **pas** réattribué.
3. `GET /api/settings` : « Prochain n° » = numéro réellement attribué ; enregistrer une valeur supérieure, puis la vérifier sur le devis suivant ; une valeur inférieure → 409.
4. Transformer un devis signé en facture : la facture a ses propres lignes ; modifier le devis → 409.
5. Supprimer un client qui a une facture → 409 (application). Une suppression directe en SQL doit aussi échouer (RESTRICT), à tester sur une donnée fictive seulement.

## 5. Retour arrière (ordre inverse, chaque script est transactionnel)

| Annuler | Fichier | Remarques |
|---|---|---|
| Étape 6 | `20261023_freeze_invoice_lines_down.sql` | Supprime uniquement les lignes tracées. **À éviter si des avoirs totaux ont été émis depuis** sur ces factures (ils ont copié ces lignes) : vérifier d'abord |
| Étape 5 | `20261022_restrict_accounting_document_deletion_down.sql` | Rétablit les cascades ; remettre `onDelete: Cascade` dans `schema.prisma` |
| Étape 4 | `20261022_unique_document_numbers_down.sql` | Supprime les index ; retirer `@@unique([userId, number])` de `schema.prisma` |
| Étape 3 | `20261023_document_number_counters_down.sql` | L'application revient au mode sans compteur (détecté automatiquement) ; les garanties D1 (choix du prochain numéro en série annuelle) et D4 (dernier brouillon supprimé) redeviennent indisponibles |

En dernier recours : restaurer la sauvegarde de l'étape 2.1.

## 6. Cohérence avec `prisma/schema.prisma`

`schema.prisma` décrit déjà l'**état cible** : modèle `DocumentNumberCounter`, `@@unique([userId, number])` sur Devis, Facture et Avoir, et `onDelete: Restrict` sur `Facture.user`, `Facture.client`, `Avoir.user`, `Avoir.client` et `Avoir.facture`. Relu manuellement : noms d'index et de contraintes conformes aux conventions Prisma. Non représentés dans le schéma, et c'est volontaire : l'activation de la RLS et la table de traçabilité `_Backfill20261023FactureLine` (à supprimer, avec accord, une fois le gel validé).

Vérification automatique, à lancer **par l'utilisateur** (la commande est bloquée pour Claude par une règle `deny` sur `prisma migrate`). Elle est hors ligne et ne contacte aucune base :

```
npx prisma migrate diff --from-schema <copie du schéma avant la mission 12> --to-schema prisma/schema.prisma --script
```

Le SQL produit doit correspondre aux étapes 3, 4 et 5, hors RLS. Ne jamais utiliser `prisma db push` : il supprimerait l'index partiel de déduplication des notifications.

## 7. D5 — proposition de mécanisme de conservation (NON implémentée)

**Objectif** : la fermeture d'un compte ne détruit jamais des factures ou avoirs soumis à obligation de conservation. Durées couramment citées, **à faire valider par un expert-comptable ou un juriste** : 10 ans pour les pièces comptables (Code de commerce, art. L123-22) et 6 ans pour le droit de contrôle fiscal (LPF, art. L102 B).

Situation actuelle : aucune route ne supprime un compte. Une suppression directe en base effacerait tout en cascade. Après l'étape 5, elle **échoue** dès qu'il existe une facture ou un avoir : c'est le premier niveau de protection.

Mécanisme proposé, à valider :
1. **Fermeture plutôt que suppression** : colonne `User.closedAt` (migration à venir) ; un compte fermé n'a plus accès à l'application, son abonnement est résilié, ses documents sont conservés en lecture seule.
2. **Export remis à l'artisan** à la fermeture : archive de ses factures et avoirs (PDF générés par `lib/pdf/generate-document-pdf.ts`), plus un récapitulatif CSV.
3. **Minimisation RGPD** pendant la conservation : suppression ou anonymisation des données non nécessaires à la valeur probante (conversations WhatsApp, notifications, opportunités, agenda), conservation des seules mentions obligatoires des factures.
4. **Purge à l'échéance** (fin de la durée légale validée) : tâche planifiée, jamais automatique sans validation, journalisée.

Décisions attendues : durées exactes, contenu de l'archive, données à anonymiser, qui déclenche la purge.
