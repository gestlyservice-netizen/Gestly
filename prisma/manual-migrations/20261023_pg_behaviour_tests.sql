-- Tests de comportement PostgreSQL des migrations 1 à 3, sur un vrai moteur.
-- Tout s'exécute dans UNE transaction terminée par ROLLBACK : aucune donnée
-- ne subsiste. Données de test fictives (préfixe pgtest_, domaine .invalid).
-- Échoue (RAISE EXCEPTION) au premier comportement inattendu ; affiche
-- « PG TESTS OK » sinon.
-- À lancer d'abord sur une COPIE (répétition locale) ; sur la base réelle,
-- uniquement après autorisation (écritures temporaires, annulées).

BEGIN;

DO $$
DECLARE
    attendu text;
BEGIN
    INSERT INTO "User" ("id", "clerkId", "email", "companyName")
    VALUES ('pgtest_user', 'pgtest_clerk', 'pgtest@example.invalid', 'PG Test');
    INSERT INTO "Client" ("id", "userId", "name") VALUES
        ('pgtest_client_fact', 'pgtest_user', 'Client facturé'),
        ('pgtest_client_brouillon', 'pgtest_user', 'Client brouillon');
    INSERT INTO "Devis" ("id", "userId", "clientId", "number") VALUES
        ('pgtest_devis_1', 'pgtest_user', 'pgtest_client_fact', 'DEV-2099-001'),
        ('pgtest_devis_2', 'pgtest_user', 'pgtest_client_brouillon', 'DEV-2099-002');
    INSERT INTO "Facture" ("id", "userId", "clientId", "devisId", "number", "totalHT", "totalTVA", "totalTTC")
    VALUES ('pgtest_facture', 'pgtest_user', 'pgtest_client_fact', 'pgtest_devis_1', 'FAC-2099-001', 100, 20, 120);
    INSERT INTO "Avoir" ("id", "userId", "factureId", "clientId", "number", "reason", "totalHT", "totalTVA", "totalTTC")
    VALUES ('pgtest_avoir', 'pgtest_user', 'pgtest_facture', 'pgtest_client_fact', 'AV-2099-001', 'test', 100, 20, 120);

    -- T1 à T3 — Migration 2 : un numéro n'existe qu'une fois par artisan.
    BEGIN
        INSERT INTO "Devis" ("id", "userId", "clientId", "number")
        VALUES ('pgtest_devis_dup', 'pgtest_user', 'pgtest_client_fact', 'DEV-2099-001');
        RAISE EXCEPTION 'T1 ÉCHEC : doublon de numéro de devis accepté';
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'T1 OK : doublon de devis refusé';
    END;
    BEGIN
        INSERT INTO "Facture" ("id", "userId", "clientId", "number", "totalHT", "totalTVA", "totalTTC")
        VALUES ('pgtest_facture_dup', 'pgtest_user', 'pgtest_client_fact', 'FAC-2099-001', 1, 0, 1);
        RAISE EXCEPTION 'T2 ÉCHEC : doublon de numéro de facture accepté';
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'T2 OK : doublon de facture refusé';
    END;
    BEGIN
        INSERT INTO "Avoir" ("id", "userId", "factureId", "clientId", "number", "reason", "totalHT", "totalTVA", "totalTTC")
        VALUES ('pgtest_avoir_dup', 'pgtest_user', 'pgtest_facture', 'pgtest_client_fact', 'AV-2099-001', 'test', 1, 0, 1);
        RAISE EXCEPTION 'T3 ÉCHEC : doublon de numéro d''avoir accepté';
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'T3 OK : doublon d''avoir refusé';
    END;

    -- T4 à T6 — Migration 3 : aucune suppression ne détruit une facture ou un avoir.
    BEGIN
        DELETE FROM "Client" WHERE "id" = 'pgtest_client_fact';
        RAISE EXCEPTION 'T4 ÉCHEC : client avec facture supprimé';
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'T4 OK : suppression d''un client facturé refusée';
    END;
    BEGIN
        DELETE FROM "Facture" WHERE "id" = 'pgtest_facture';
        RAISE EXCEPTION 'T5 ÉCHEC : facture avec avoir supprimée';
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'T5 OK : suppression d''une facture avec avoir refusée';
    END;
    BEGIN
        DELETE FROM "User" WHERE "id" = 'pgtest_user';
        RAISE EXCEPTION 'T6 ÉCHEC : compte avec documents comptables supprimé';
    EXCEPTION WHEN foreign_key_violation THEN RAISE NOTICE 'T6 OK : suppression d''un compte avec factures refusée';
    END;

    -- T7 — Les suppressions autorisées fonctionnent toujours (client sans facture).
    DELETE FROM "Client" WHERE "id" = 'pgtest_client_brouillon';
    IF EXISTS (SELECT 1 FROM "Devis" WHERE "id" = 'pgtest_devis_2') THEN
        RAISE EXCEPTION 'T7 ÉCHEC : le devis du client supprimé subsiste (cascade attendue)';
    END IF;
    RAISE NOTICE 'T7 OK : client sans facture supprimé avec ses devis';

    -- T8 — Migration 1 : un compteur unique par (artisan, type, série).
    INSERT INTO "DocumentNumberCounter" ("id", "userId", "kind", "series", "nextValue", "updatedAt")
    VALUES ('pgtest_counter', 'pgtest_user', 'devis', 'DEV-2099-', 3, now());
    BEGIN
        INSERT INTO "DocumentNumberCounter" ("id", "userId", "kind", "series", "nextValue", "updatedAt")
        VALUES ('pgtest_counter_dup', 'pgtest_user', 'devis', 'DEV-2099-', 9, now());
        RAISE EXCEPTION 'T8 ÉCHEC : compteur en double accepté';
    EXCEPTION WHEN unique_violation THEN RAISE NOTICE 'T8 OK : compteur en double refusé';
    END;

    -- T9 — Upsert utilisé par l'application (Prisma) : ON CONFLICT sur la clé composée.
    INSERT INTO "DocumentNumberCounter" ("id", "userId", "kind", "series", "nextValue", "updatedAt")
    VALUES ('pgtest_counter_2', 'pgtest_user', 'devis', 'DEV-2099-', 4, now())
    ON CONFLICT ("userId", "kind", "series") DO UPDATE SET "nextValue" = EXCLUDED."nextValue";
    SELECT "nextValue"::text INTO attendu FROM "DocumentNumberCounter" WHERE "id" = 'pgtest_counter';
    IF attendu <> '4' THEN RAISE EXCEPTION 'T9 ÉCHEC : upsert du compteur incorrect (%)', attendu; END IF;
    RAISE NOTICE 'T9 OK : upsert du compteur sur (userId, kind, series)';

    -- T10 — Verrou consultatif et détection de la table (lib/numbering/document-number.ts).
    PERFORM pg_advisory_xact_lock(hashtext('gestly:devis-number:pgtest_user'));
    IF to_regclass('public."DocumentNumberCounter"') IS NULL THEN
        RAISE EXCEPTION 'T10 ÉCHEC : détection to_regclass';
    END IF;
    RAISE NOTICE 'T10 OK : verrou consultatif et détection de la table';

    RAISE NOTICE 'PG TESTS OK';
END $$;

ROLLBACK;
