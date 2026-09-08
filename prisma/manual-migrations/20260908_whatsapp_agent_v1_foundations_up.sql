-- Étape 1 — fondations de données pour l'agent IA WhatsApp + relances devis.
-- Purement additif : nouvelles colonnes nullables/à défaut, nouvelles tables.
-- Aucune colonne existante modifiée ou supprimée, aucune donnée touchée.
-- Généré par `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
-- le 2026-09-08, puis nettoyé d'une ligne de drift sans rapport (défaut de
-- User.trialEndsAt, non lié à ce travail, volontairement exclu ici).

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Devis" ADD COLUMN     "signatureHash" TEXT,
ADD COLUMN     "signatureIp" TEXT,
ADD COLUMN     "signatureName" TEXT,
ADD COLUMN     "signatureUserAgent" TEXT;

-- CreateTable
CREATE TABLE "RelanceDevisSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "delaiJ1" INTEGER NOT NULL DEFAULT 3,
    "delaiJ2" INTEGER NOT NULL DEFAULT 7,
    "delaiJ3" INTEGER NOT NULL DEFAULT 14,
    "canalEmail" BOOLEAN NOT NULL DEFAULT true,
    "canalSms" BOOLEAN NOT NULL DEFAULT false,
    "messageJ1" TEXT,
    "messageJ2" TEXT,
    "messageJ3" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelanceDevisSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelanceDevis" (
    "id" TEXT NOT NULL,
    "devisId" TEXT NOT NULL,
    "niveau" INTEGER NOT NULL,
    "canal" TEXT NOT NULL,
    "statut" TEXT NOT NULL,
    "erreur" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "envoyeeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RelanceDevis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'idle',
    "pendingDevis" JSONB,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "externalId" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappJob" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RelanceDevisSettings_userId_key" ON "RelanceDevisSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RelanceDevis_devisId_niveau_canal_key" ON "RelanceDevis"("devisId", "niveau", "canal");

-- CreateIndex
CREATE INDEX "WhatsappConversation_phoneNumber_idx" ON "WhatsappConversation"("phoneNumber");

-- CreateIndex
CREATE INDEX "WhatsappConversation_userId_idx" ON "WhatsappConversation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappMessage_externalId_key" ON "WhatsappMessage"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappJob_messageId_key" ON "WhatsappJob"("messageId");

-- CreateIndex
CREATE INDEX "WhatsappJob_status_idx" ON "WhatsappJob"("status");

-- AddForeignKey
ALTER TABLE "RelanceDevisSettings" ADD CONSTRAINT "RelanceDevisSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelanceDevis" ADD CONSTRAINT "RelanceDevis_devisId_fkey" FOREIGN KEY ("devisId") REFERENCES "Devis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappJob" ADD CONSTRAINT "WhatsappJob_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "WhatsappMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
