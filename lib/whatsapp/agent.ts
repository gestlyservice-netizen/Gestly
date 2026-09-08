import type { WhatsappMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { claimJob } from "@/lib/whatsapp/job-queue";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { processTextMessage } from "@/lib/whatsapp/conversation-turn";
import { resolveVoiceMessageText } from "@/lib/whatsapp/voice-message";
import {
  buildVoiceMediaNotFoundReply,
  buildVoiceUnsupportedFormatReply,
  buildVoiceTooLargeReply,
  buildVoiceEmptyReply,
} from "@/lib/whatsapp/reply-builder";

// Point d'entrée unique du traitement métier des jobs WhatsApp. Le webhook
// ne fait qu'y déléguer — aucune logique métier n'existe ailleurs. Toute la
// compréhension/fusion/confirmation/création vit dans des modules dédiés
// (conversation-turn.ts, confirm-creation.ts, extraction.ts...) — ce fichier
// reste une simple plomberie : réclamer le job, charger le message, déléguer,
// envoyer la réponse, persister l'historique, marquer le job terminé.
//
// Étape 5 : confirmation explicite puis création réelle du devis (client +
// devis + lignes, transactionnelle et idempotente). Toujours aucun PDF,
// aucun envoi au client final, aucun statut "envoyé" à ce stade — ça reste
// l'étape 6.
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

    const replyText = await buildReply(message, conversation.id, conversation.userId);

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

// Point d'entrée unique pour produire la réponse d'un message entrant,
// texte ou vocal. Une fois transcrit, un message vocal devient une entrée
// textuelle ordinaire pour processTextMessage — jamais un second agent, ni
// de logique métier parallèle spécifique à l'audio au-delà de la
// résolution de son texte.
async function buildReply(message: WhatsappMessage, conversationId: string, userId: string): Promise<string> {
  if (message.type !== "audio") {
    return processTextMessage(conversationId, userId, message.content);
  }

  const voice = await resolveVoiceMessageText(message, userId);

  if (voice.kind === "transcribed") {
    return processTextMessage(conversationId, userId, voice.text);
  }

  if (voice.reason === "media_not_found") return buildVoiceMediaNotFoundReply();
  if (voice.reason === "unsupported_format") return buildVoiceUnsupportedFormatReply();
  if (voice.reason === "too_large") return buildVoiceTooLargeReply();
  return buildVoiceEmptyReply();
}
