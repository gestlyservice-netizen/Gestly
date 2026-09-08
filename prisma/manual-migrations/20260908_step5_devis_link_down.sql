-- Retour arrière pour 20260908_step5_devis_link_up.sql — sûr à tout moment,
-- la colonne est nouvelle et nullable (aucune perte de données existantes).
ALTER TABLE "WhatsappConversation" DROP COLUMN IF EXISTS "lastCreatedDevisId";
