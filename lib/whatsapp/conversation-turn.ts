import type { LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { extractDevisInfo } from "@/lib/whatsapp/extraction";
import { resolveClient } from "@/lib/whatsapp/client-resolution";
import { confirmDevisCreation } from "@/lib/whatsapp/confirm-creation";
import {
  buildReplyForIntent,
  buildAmbiguousConfirmationReply,
  buildCreationDeclinedReply,
  buildDevisCreatedReply,
  buildInsufficientDataForCreationReply,
} from "@/lib/whatsapp/reply-builder";
import { emptyPendingDevis, applyExtractionToPendingDevis, type PendingDevis } from "@/lib/whatsapp/pending-devis";
import { DEFAULT_TVA_RATE } from "@/lib/ai/config";

// Orchestration complète d'un tour de conversation texte : comprendre,
// compléter, confirmer la création, créer le devis, confirmer l'envoi.
// L'envoi lui-même (génération PDF + appel WhatsApp vers le client) reste
// entièrement hors de ce fichier — c'est l'étape 6.
export async function processTextMessage(
  conversationId: string,
  userId: string,
  messageContent: string,
  opts: { model?: LanguageModel | string } = {}
): Promise<string> {
  const conversationRow = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const currentPendingDevis: PendingDevis =
    (conversationRow.pendingDevis as unknown as PendingDevis) ?? emptyPendingDevis();

  // Idempotence de lecture : si un devis a déjà été créé pour cette
  // conversation et qu'on attend la confirmation d'envoi, on ne relance
  // jamais l'extraction/la création — on rappelle simplement l'état réel,
  // quel que soit le message reçu entre-temps (rejeu, double confirmation,
  // nouveau message avant que l'artisan ait vu la réponse précédente...).
  if (conversationRow.state === "awaiting_send_confirmation" && conversationRow.lastCreatedDevisId) {
    const devis = await prisma.devis.findUnique({
      where: { id: conversationRow.lastCreatedDevisId },
      include: { client: true },
    });
    if (devis) {
      return buildDevisCreatedReply(devis.number, devis.client.name, devis.totalTTC);
    }
  }

  const recentMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const recentHistory = recentMessages
    .reverse()
    .map((m) => ({ direction: m.direction as "in" | "out", content: m.content }));

  // Une extraction qui échoue remonte telle quelle jusqu'à processWhatsappJob,
  // qui marque le job 'failed' sans rien perdre — le message et la
  // conversation restent intacts pour un retry ultérieur.
  const raw = await extractDevisInfo({ message: messageContent, recentHistory, currentPendingDevis }, opts);

  // ── Gestion spécifique de la confirmation de création ──────────────────
  if (conversationRow.state === "awaiting_creation_confirmation" && raw.intent === "confirmation") {
    if (raw.reponseConfirmation === "oui") {
      const outcome = await confirmDevisCreation(conversationId, userId, currentPendingDevis);

      if (outcome.kind === "created" || outcome.kind === "already_created") {
        return buildDevisCreatedReply(outcome.number, outcome.clientName, outcome.totalTTC);
      }
      if (outcome.kind === "insufficient_data") {
        return buildInsufficientDataForCreationReply(outcome.missing);
      }

      // "not_claimed" : un autre traitement a tranché entre-temps (course
      // gagnée ailleurs, ou état déjà changé). On relit l'état réel sans
      // relancer une nouvelle extraction IA — jamais de recréation.
      const fresh = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversationId } });
      if (fresh.state === "awaiting_send_confirmation" && fresh.lastCreatedDevisId) {
        const devis = await prisma.devis.findUnique({
          where: { id: fresh.lastCreatedDevisId },
          include: { client: true },
        });
        if (devis) return buildDevisCreatedReply(devis.number, devis.client.name, devis.totalTTC);
      }
      return buildAmbiguousConfirmationReply(currentPendingDevis);
    }

    if (raw.reponseConfirmation === "non") {
      await prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { state: "collecting" },
      });
      return buildCreationDeclinedReply();
    }

    // "ambigu" ou valeur inattendue : ne rien créer, redemander clairement.
    return buildAmbiguousConfirmationReply(currentPendingDevis);
  }

  // ── Cas général (étape 4 inchangée) : compréhension + fusion du brouillon
  const nextPendingDevis = await applyExtractionToPendingDevis(
    currentPendingDevis,
    raw,
    DEFAULT_TVA_RATE,
    (name, phone) => resolveClient(userId, name, phone)
  );

  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { pendingDevis: nextPendingDevis as unknown as object, state: nextPendingDevis.state },
  });

  return buildReplyForIntent(nextPendingDevis, raw);
}
