-- Étape 5 (correctif) — horodatage nécessaire pour détecter un état
-- "creating" resté bloqué après un délai (et non immédiatement). Table
-- vide au moment de la migration (0 ligne) ; DEFAULT NOW() ajouté par
-- prudence si des lignes existaient déjà.
ALTER TABLE "WhatsappConversation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
