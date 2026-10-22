-- ⚠️ PROPOSITION — NE PAS EXÉCUTER sans l'accord explicite de l'utilisateur.
--
-- Décision D6 : une facture émise ne change pas. Jusqu'ici, une facture
-- créée depuis un devis (POST /api/devis/[id]/to-facture) n'avait AUCUNE
-- ligne propre et affichait les lignes du devis lié : modifier le devis
-- modifiait la facture. Le code copie désormais les lignes à l'émission ;
-- cette migration de DONNÉES fige de la même façon les factures existantes
-- (copie des lignes du devis dans FactureLine), uniquement pour celles qui
-- n'ont aucune ligne propre.
--
-- ⚠️ Les lignes copiées sont celles du devis AU MOMENT DE LA MIGRATION. Si
-- un devis a été modifié après sa facturation, la facture figée reprendra
-- ce contenu modifié : contrôler les cas listés par le contrôle préalable
-- avant d'appliquer.
--
-- Réversible : les identifiants des lignes créées sont tracés dans une
-- table dédiée, utilisée par le script de retour arrière.

BEGIN;

CREATE TABLE "_Backfill20261023FactureLine" ("factureLineId" TEXT PRIMARY KEY);

WITH inserted AS (
    INSERT INTO "FactureLine" ("id", "factureId", "description", "quantity", "unitPriceHT", "tvaRate", "totalHT")
    SELECT gen_random_uuid()::text, f."id", dl."description", dl."quantity", dl."unitPriceHT", dl."tvaRate", dl."totalHT"
    FROM "Facture" f
    JOIN "DevisLine" dl ON dl."devisId" = f."devisId"
    WHERE f."devisId" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "FactureLine" fl WHERE fl."factureId" = f."id")
    RETURNING "id"
)
INSERT INTO "_Backfill20261023FactureLine" ("factureLineId") SELECT "id" FROM inserted;

ALTER TABLE "_Backfill20261023FactureLine" ENABLE ROW LEVEL SECURITY;

COMMIT;
