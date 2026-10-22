-- Étape 8bis — checkpoint d'idempotence de l'extraction IA WhatsApp.
-- Purement additif : nouvelles colonnes nullables sur WhatsappMessage (sauf
-- updatedAt, NOT NULL avec DEFAULT CURRENT_TIMESTAMP pour les lignes
-- existantes) + lien optionnel messageId sur AiUsageEvent.
ALTER TABLE "WhatsappMessage"
  ADD COLUMN "extractionStatus" TEXT,
  ADD COLUMN "extractionResult" JSONB,
  ADD COLUMN "extractionModel" TEXT,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "AiUsageEvent" ADD COLUMN "messageId" TEXT;

CREATE INDEX "AiUsageEvent_messageId_idx" ON "AiUsageEvent"("messageId");

ALTER TABLE "AiUsageEvent" ADD CONSTRAINT "AiUsageEvent_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "WhatsappMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
