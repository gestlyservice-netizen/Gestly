import { prisma } from "@/lib/prisma";
import { claimJob } from "@/lib/whatsapp/job-queue";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { extractDevisInfo } from "@/lib/whatsapp/extraction";
import { resolveClient } from "@/lib/whatsapp/client-resolution";
import { buildReplyForIntent } from "@/lib/whatsapp/reply-builder";
import {
  emptyPendingDevis,
  applyExtractionToPendingDevis,
  type PendingDevis,
  type RawExtraction,
} from "@/lib/whatsapp/pending-devis";
import { DEFAULT_TVA_RATE } from "@/lib/ai/config";

// Point d'entrée unique du traitement métier des jobs WhatsApp. Le webhook
// ne fait qu'y déléguer — aucune logique métier n'existe ailleurs.
//
// Étape 4 : compréhension et structuration du brouillon de devis (extraction
// IA + résolution client + fusion multi-tours). Toujours AUCUNE création de
// Devis réel, aucun PDF, aucun envoi au client final à ce stade — seule la
// conversation avec l'artisan progresse. La création réelle est l'étape 5.
//
// Retourne true seulement si CE processus a effectivement réclamé et
// traité le job (succès ou échec) — false s'il a été ignoré parce que déjà
// pris en charge ailleurs ou plus reprenable. Sert à un reporting exact côté
// appelant (ex. /api/whatsapp/process-pending), pas seulement à décider s'il
// faut agir.
export async function processWhatsappJob(jobId: string): Promise<boolean> {
  const claimed = await claimJob(jobId);
  if (!claimed) {
    // Déjà en cours de traitement ailleurs, déjà terminé, ou plus reprenable
    // (trop de tentatives) — on n'agit jamais deux fois sur le même job.
    // Conséquence directe : aucun nouvel appel IA pour un job déjà traité.
    return false;
  }

  try {
    const job = await prisma.whatsappJob.findUnique({
      where: { id: jobId },
      include: {
        message: {
          include: {
            conversation: { include: { user: true } },
          },
        },
      },
    });

    if (!job || !job.message) {
      throw new Error("Job ou message associé introuvable");
    }

    const { message } = job;
    const { conversation } = message;

    if (!conversation || !conversation.userId || !conversation.user) {
      throw new Error("Conversation invalide ou non identifiée (utilisateur manquant)");
    }

    const replyText =
      message.type === "audio"
        ? buildAudioPlaceholderReply()
        : await buildTextReply(conversation.id, conversation.userId, message.content);

    await sendWhatsappText(conversation.phoneNumber, replyText);

    // Historique réellement bidirectionnel : le message sortant est
    // persisté au même titre que les messages entrants.
    await prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "out",
        type: "text",
        content: replyText,
      },
    });

    await prisma.whatsappJob.update({
      where: { id: jobId },
      data: { status: "done", lastError: null },
    });
    return true;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp/agent] échec du traitement du job ${jobId}:`, detail);
    // On ne détruit jamais le message reçu ni l'historique de conversation :
    // seul le statut du job change, tout le reste reste intact pour un
    // retry ultérieur (cf. lib/whatsapp/job-queue.ts).
    await prisma.whatsappJob.update({
      where: { id: jobId },
      data: { status: "failed", lastError: detail.slice(0, 500) },
    });
    return true;
  }
}

function buildAudioPlaceholderReply(): string {
  return (
    "Message vocal bien reçu ✅\n\n" +
    "La transcription automatique n'est pas encore activée — cette fonctionnalité arrive à une prochaine étape."
  );
}

async function buildTextReply(conversationId: string, userId: string, messageContent: string): Promise<string> {
  const conversationRow = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const currentPendingDevis: PendingDevis = (conversationRow.pendingDevis as unknown as PendingDevis) ?? emptyPendingDevis();

  const recentMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const recentHistory = recentMessages
    .reverse()
    .map((m) => ({ direction: m.direction as "in" | "out", content: m.content }));

  // Une extraction qui échoue (ExtractionError après retry, ou toute autre
  // erreur) remonte telle quelle jusqu'à processWhatsappJob, qui marque le
  // job 'failed' sans rien perdre — le message et la conversation restent
  // intacts pour un retry ultérieur.
  const raw: RawExtraction = await extractDevisInfo({
    message: messageContent,
    recentHistory,
    currentPendingDevis,
  });

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
