-- Script de retour arrière pour 20260908_whatsapp_agent_v1_foundations_up.sql
-- Sûr à exécuter à tout moment : toutes les tables/colonnes créées par la
-- migration "up" sont vides à l'origine (aucune donnée de production dans
-- ces colonnes/tables au moment de leur création), donc aucune perte de
-- données existantes. Ordre inverse pour respecter les clés étrangères.

DROP TABLE IF EXISTS "WhatsappJob";
DROP TABLE IF EXISTS "WhatsappMessage";
DROP TABLE IF EXISTS "WhatsappConversation";
DROP TABLE IF EXISTS "RelanceDevis";
DROP TABLE IF EXISTS "RelanceDevisSettings";

ALTER TABLE "Devis"
  DROP COLUMN IF EXISTS "signatureHash",
  DROP COLUMN IF EXISTS "signatureIp",
  DROP COLUMN IF EXISTS "signatureName",
  DROP COLUMN IF EXISTS "signatureUserAgent";

ALTER TABLE "Client" DROP COLUMN IF EXISTS "whatsappOptOut";
