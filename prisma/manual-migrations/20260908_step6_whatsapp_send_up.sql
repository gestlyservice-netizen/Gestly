-- Étape 6 — suivi dédié et persistant de l'envoi WhatsApp d'un devis.
-- Purement additif : nouvelle table, et un simple DROP DEFAULT sur une
-- colonne existante (n'affecte aucune donnée, Prisma gère updatedAt
-- applicativement).
ALTER TABLE "WhatsappConversation" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "WhatsappSend" (
    "id" TEXT NOT NULL,
    "devisId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "externalMessageId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsappSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsappSend_devisId_key" ON "WhatsappSend"("devisId");
CREATE UNIQUE INDEX "WhatsappSend_externalMessageId_key" ON "WhatsappSend"("externalMessageId");
CREATE INDEX "WhatsappSend_status_idx" ON "WhatsappSend"("status");

ALTER TABLE "WhatsappSend" ADD CONSTRAINT "WhatsappSend_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsappSend" ADD CONSTRAINT "WhatsappSend_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
