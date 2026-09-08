DROP TABLE IF EXISTS "WhatsappSend";
ALTER TABLE "WhatsappConversation" ALTER COLUMN "updatedAt" SET DEFAULT NOW();
