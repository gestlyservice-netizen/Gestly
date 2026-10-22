DROP INDEX IF EXISTS "Notification_userId_dedupeKey_key";
ALTER TABLE "Notification" DROP COLUMN IF EXISTS "dedupeKey";
