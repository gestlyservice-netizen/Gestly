-- Étape 8bis — unicité anti-doublon de createNotificationOnce garantie au
-- niveau base de données (plutôt que par la seule convention applicative
-- findFirst+create, non atomique sous course concurrente).
--
-- Index UNIQUE PARTIEL (WHERE "dedupeKey" IS NOT NULL) : ne s'applique
-- jamais aux notifications créées par createNotification (dedupeKey reste
-- NULL), en particulier "relance_envoyee"/"relance_echouee"
-- (lib/relances/engine.ts) qui réutilisent intentionnellement le même
-- (userId, type, link) à chaque niveau de relance. Purement additif :
-- nouvelle colonne nullable + nouvel index, aucune ligne existante
-- modifiée, aucun comportement existant cassé.
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key"
  ON "Notification"("userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;
