import { prisma } from "@/lib/prisma";
import { claimJob } from "@/lib/whatsapp/job-queue";
import { sendWhatsappText } from "@/lib/whatsapp/send";

// Point d'entrée unique du traitement métier des jobs WhatsApp. Le webhook
// ne fait qu'y déléguer — aucune logique métier n'existe ailleurs.
//
// Étape 3 : aucune IA, aucune transcription, aucun devis. Réponse
// déterministe (écho contrôlé) pour valider tout le tunnel webhook →
// message → job → orchestrateur → conversation → réponse WhatsApp →
// historique bidirectionnel.
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

    const replyText = buildDeterministicReply(message.type, message.content);

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

function buildDeterministicReply(messageType: string, content: string): string {
  if (messageType === "audio") {
    return (
      "Message vocal bien reçu ✅\n\n" +
      "La transcription automatique n'est pas encore activée — cette fonctionnalité arrive à une prochaine étape."
    );
  }

  const excerpt = content.length > 200 ? content.slice(0, 200) + "…" : content;
  return (
    `Message bien reçu ✅\n« ${excerpt} »\n\n` +
    "(Réponse automatique de test — la compréhension par IA arrive à l'étape suivante du projet.)"
  );
}
