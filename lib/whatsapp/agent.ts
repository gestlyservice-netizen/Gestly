import type { WhatsappMessage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { claimJob } from "@/lib/whatsapp/job-queue";
import { sendWhatsappText } from "@/lib/whatsapp/send";
import { processTextMessage } from "@/lib/whatsapp/conversation-turn";
import { resolveVoiceMessageText } from "@/lib/whatsapp/voice-message";
import { isStopCommand, isStartCommand, disableArtisanBot, enableArtisanBot } from "@/lib/whatsapp/artisan-optout";
import { isAiQuotaExceeded } from "@/lib/ai/usage";
import {
  buildVoiceMediaNotFoundReply,
  buildVoiceUnsupportedFormatReply,
  buildVoiceTooLargeReply,
  buildVoiceEmptyReply,
  buildVoiceSuspectReply,
  buildStopConfirmationReply,
  buildStartConfirmationReply,
  buildAiQuotaExceededReply,
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

    const replyText = await buildReply(message, conversation.id, conversation.userId, conversation.optedOut);

    // null = silence volontaire (conversation en opt-out en dehors de la
    // confirmation initiale de désactivation, cf. mécanisme 1) : aucun envoi
    // WhatsApp, aucun message sortant persisté, mais le job est bien marqué
    // "done" — ce n'est pas un échec, c'est le comportement attendu.
    if (replyText !== null) {
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
    }

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
//
// Ordre des garde-fous (étape 8), volontairement strict et jamais mélangé :
//   1. STOP/START artisan (mécanisme 1) — toujours évalué en premier, sans
//      jamais appeler l'IA, quel que soit l'état courant.
//   2. Silence total si la conversation est en opt-out (mécanisme 1).
//   3. Plafond d'usage IA (mécanisme 3) — vérifié AVANT tout appel IA,
//      texte comme vocal.
//   4. Traitement normal (extraction/transcription, mécanisme 4 inclus
//      dans conversation-turn.ts pour l'escalade sur blocage conversationnel).
//
// Retourne null pour signifier "aucune réponse à envoyer" (silence) —
// distinct d'une chaîne vide, qui resterait un message WhatsApp réel.
// Exporté uniquement pour les tests (lib/whatsapp/agent.test.ts) : c'est le
// point d'entrée qui applique réellement l'ordre des garde-fous, donc celui
// qu'il faut exercer directement plutôt que de reconstruire tout le pipeline
// (claimJob, WhatsappJob, envoi Meta...) dans chaque test.
export async function buildReply(
  message: WhatsappMessage,
  conversationId: string,
  userId: string,
  isOptedOut: boolean
): Promise<string | null> {
  // ── Mécanisme 1, isolé : STOP / START artisan → bot ────────────────────
  if (message.type === "text") {
    if (isStopCommand(message.content)) {
      if (isOptedOut) {
        // Déjà désactivé : le bot a déjà confirmé une fois, on ne relance
        // jamais une seconde confirmation.
        return null;
      }
      await disableArtisanBot(conversationId);
      return buildStopConfirmationReply();
    }
    if (isStartCommand(message.content) && isOptedOut) {
      await enableArtisanBot(conversationId);
      return buildStartConfirmationReply();
    }
  }

  if (isOptedOut) {
    // Conversation désactivée : aucun appel IA, aucune transcription,
    // aucune création/envoi de devis, aucune réponse — silence total tant
    // que START n'a pas été reçu explicitement.
    return null;
  }

  // ── Mécanisme 3, isolé : plafond d'usage IA ────────────────────────────
  if (await isAiQuotaExceeded(userId)) {
    return buildAiQuotaExceededReply();
  }

  if (message.type !== "audio") {
    return processTextMessage(conversationId, userId, message.id, message.content);
  }

  const voice = await resolveVoiceMessageText(message, userId);

  if (voice.kind === "transcribed") {
    // Même WhatsappMessage (celui du vocal) sert de clé de checkpoint pour
    // l'extraction — un message entrant, qu'il soit texte ou vocal
    // transcrit, ne produit jamais plus d'une extraction réelle.
    return processTextMessage(conversationId, userId, message.id, voice.text);
  }

  if (voice.reason === "media_not_found") return buildVoiceMediaNotFoundReply();
  if (voice.reason === "unsupported_format") return buildVoiceUnsupportedFormatReply();
  if (voice.reason === "too_large") return buildVoiceTooLargeReply();
  if (voice.reason === "suspect") return buildVoiceSuspectReply();
  return buildVoiceEmptyReply();
}
