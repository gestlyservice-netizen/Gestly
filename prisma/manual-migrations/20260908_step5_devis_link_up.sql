-- Étape 5 — lien entre la conversation WhatsApp et le devis réellement créé.
-- Purement additif : une colonne nullable, aucune donnée existante touchée.
ALTER TABLE "WhatsappConversation" ADD COLUMN "lastCreatedDevisId" TEXT;
