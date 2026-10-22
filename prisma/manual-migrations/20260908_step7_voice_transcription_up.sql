-- Étape 7 — champs dédiés à la transcription vocale sur WhatsappMessage.
-- Purement additif : colonnes nullables uniquement.
ALTER TABLE "WhatsappMessage" ADD COLUMN "durationSeconds" INTEGER,
ADD COLUMN "mediaId" TEXT,
ADD COLUMN "mimeType" TEXT,
ADD COLUMN "transcription" TEXT,
ADD COLUMN "transcriptionModel" TEXT,
ADD COLUMN "transcriptionMs" INTEGER,
ADD COLUMN "transcriptionStatus" TEXT;
