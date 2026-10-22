ALTER TABLE "AiUsageEvent" DROP CONSTRAINT IF EXISTS "AiUsageEvent_messageId_fkey";
DROP INDEX IF EXISTS "AiUsageEvent_messageId_idx";
ALTER TABLE "AiUsageEvent" DROP COLUMN IF EXISTS "messageId";

ALTER TABLE "WhatsappMessage"
  DROP COLUMN IF EXISTS "extractionStatus",
  DROP COLUMN IF EXISTS "extractionResult",
  DROP COLUMN IF EXISTS "extractionModel",
  DROP COLUMN IF EXISTS "updatedAt";
