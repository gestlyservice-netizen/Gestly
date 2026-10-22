ALTER TABLE "WhatsappMessage"
  DROP COLUMN IF EXISTS "durationSeconds",
  DROP COLUMN IF EXISTS "mediaId",
  DROP COLUMN IF EXISTS "mimeType",
  DROP COLUMN IF EXISTS "transcription",
  DROP COLUMN IF EXISTS "transcriptionModel",
  DROP COLUMN IF EXISTS "transcriptionMs",
  DROP COLUMN IF EXISTS "transcriptionStatus";
