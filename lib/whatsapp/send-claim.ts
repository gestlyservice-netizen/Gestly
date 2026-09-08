import { Prisma, type WhatsappSend } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const MAX_SEND_ATTEMPTS = 5;
const STALE_PROCESSING_MS = 5 * 60 * 1000;

export type SendClaimResult =
  | { outcome: "claimed"; send: WhatsappSend }
  | { outcome: "already_succeeded"; send: WhatsappSend }
  | { outcome: "not_claimed"; send: WhatsappSend | null };

// Réclame (ou crée) l'unique WhatsappSend d'un devis pour tentative
// exclusive. devisId est @unique en base : un seul WhatsappSend existera
// jamais pour ce devis, quel que soit le nombre de tentatives — c'est la
// garantie de dernier recours contre un double envoi, même en cas de bug
// dans cette logique de réclamation elle-même.
export async function claimSendAttempt(devisId: string, conversationId: string): Promise<SendClaimResult> {
  let send = await prisma.whatsappSend.findUnique({ where: { devisId } });

  if (!send) {
    try {
      send = await prisma.whatsappSend.create({
        data: { devisId, conversationId, status: "processing", attempts: 1 },
      });
      return { outcome: "claimed", send };
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      // Course : un autre appel a créé la ligne entre notre lecture et notre
      // écriture — on relit et on retombe dans la logique normale ci-dessous.
      send = await prisma.whatsappSend.findUniqueOrThrow({ where: { devisId } });
    }
  }

  if (send.status === "success") {
    // Le message a déjà été accepté par Meta (éventuellement lors d'une
    // tentative précédente interrompue avant la finalisation). Jamais un
    // second appel Meta : l'appelant doit seulement finaliser.
    return { outcome: "already_succeeded", send };
  }

  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claim = await prisma.whatsappSend.updateMany({
    where: {
      id: send.id,
      attempts: { lt: MAX_SEND_ATTEMPTS },
      OR: [
        { status: "pending" },
        { status: "failed" },
        { status: "processing", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "processing", attempts: { increment: 1 } },
  });

  const fresh = await prisma.whatsappSend.findUniqueOrThrow({ where: { id: send.id } });

  if (claim.count === 0) {
    // Soit déjà réussi entre-temps (course), soit pris en charge ailleurs,
    // soit tentatives épuisées.
    return fresh.status === "success"
      ? { outcome: "already_succeeded", send: fresh }
      : { outcome: "not_claimed", send: fresh };
  }

  return { outcome: "claimed", send: fresh };
}

export async function markSendFailed(sendId: string, message: string): Promise<void> {
  await prisma.whatsappSend.update({
    where: { id: sendId },
    data: { status: "failed", lastError: message.slice(0, 500) },
  });
}

export async function markSendSuccess(sendId: string, externalMessageId: string): Promise<void> {
  await prisma.whatsappSend.update({
    where: { id: sendId },
    data: { status: "success", externalMessageId, lastError: null },
  });
}
