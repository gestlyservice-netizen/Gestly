import { Prisma, type WhatsappSend } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhoneE164 } from "@/lib/phone";
import { generateDevisPdfBuffer } from "@/lib/pdf/generate-document-pdf";
import { uploadWhatsappMedia } from "@/lib/whatsapp/media";
import { sendWhatsappDocument } from "@/lib/whatsapp/send";
import { claimSendAttempt, markSendFailed, markSendSuccess, MAX_SEND_ATTEMPTS } from "@/lib/whatsapp/send-claim";
import { escalateToArtisan } from "@/lib/whatsapp/escalation";

export type SendDevisOutcome =
  | { kind: "sent"; number: string; clientName: string }
  | { kind: "already_sent"; number: string; clientName: string }
  | { kind: "not_claimed" }
  | { kind: "cannot_send"; reason: "no_phone" | "invalid_phone" | "opted_out" | "wrong_owner" }
  | { kind: "failed" };

// Vérification de forme minimale d'un numéro déjà normalisé E.164 — pas une
// validation exhaustive, juste de quoi écarter une valeur manifestement
// inexploitable avant de dépenser un appel Meta.
function isPlausibleE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Échec définitif = échec sur la tentative qui a atteint le plafond
// MAX_SEND_ATTEMPTS (claimSendAttempt exclut déjà toute réclamation
// ultérieure au-delà de ce plafond — aucun retry ne suivra). Escalade
// (mécanisme 4) uniquement dans ce cas, jamais sur un échec transitoire qui
// sera retenté automatiquement.
async function markFailedAndMaybeEscalate(
  send: WhatsappSend,
  userId: string,
  devisNumber: string,
  message: string
): Promise<void> {
  await markSendFailed(send.id, message);
  if (send.attempts >= MAX_SEND_ATTEMPTS) {
    await escalateToArtisan(
      userId,
      "envoi_echec",
      send.devisId,
      `L'envoi WhatsApp du devis ${devisNumber} a échoué de façon définitive après ${MAX_SEND_ATTEMPTS} tentatives (${message}). Le devis reste créé, il faudra l'envoyer autrement.`
    );
  }
}

// Workflow complet : awaiting_send_confirmation -> validation destinataire
// et droits -> génération PDF -> upload média -> envoi document -> preuve
// Meta persistée -> devis "envoye" + sentAt -> conversation finalisée.
//
// Sécurité contre le double envoi : la garantie vient de
// lib/whatsapp/send-claim.ts (contrainte unique WhatsappSend.devisId +
// réclamation atomique de son statut), PAS de l'état de la conversation.
// L'état "sending" posé ici n'est qu'un indicateur informatif — le
// réclamer à nouveau après un crash (état resté à "sending") est sans
// risque puisque seule la réclamation sur WhatsappSend fait autorité.
export async function sendDevisToClient(conversationId: string, userId: string): Promise<SendDevisOutcome> {
  const conversation = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });
  if (!conversation || !conversation.lastCreatedDevisId) return { kind: "not_claimed" };

  const devisId = conversation.lastCreatedDevisId;
  const devis = await prisma.devis.findUnique({ where: { id: devisId }, include: { client: true, lines: true } });
  if (!devis) return { kind: "not_claimed" };

  // Le devis doit appartenir au même utilisateur que la conversation —
  // vérification défensive, ne devrait jamais échouer en usage normal.
  if (devis.userId !== userId) return { kind: "cannot_send", reason: "wrong_owner" };

  if (devis.status === "envoye") {
    // Déjà envoyé par un traitement précédent complet — idempotence de
    // lecture, aucun appel Meta. Vérifié AVANT l'état de la conversation :
    // une fois l'envoi terminé, la conversation repasse à "idle" (plus
    // "awaiting_send_confirmation"/"sending"), ce qui ne doit jamais être
    // interprété comme "rien à faire ici", mais bien comme "déjà envoyé".
    return { kind: "already_sent", number: devis.number, clientName: devis.client.name };
  }

  if (conversation.state !== "awaiting_send_confirmation" && conversation.state !== "sending") {
    return { kind: "not_claimed" };
  }

  // Numéro du client CRM lié — jamais celui du brouillon pendingDevis, qui
  // peut avoir changé ou ne plus être cohérent avec le client réellement
  // sélectionné/créé. Client.phone est la seule source de vérité ici.
  const rawPhone = devis.client.phone;
  if (!rawPhone) return { kind: "cannot_send", reason: "no_phone" };
  const phone = normalizePhoneE164(rawPhone);
  if (!isPlausibleE164(phone)) return { kind: "cannot_send", reason: "invalid_phone" };
  if (devis.client.whatsappOptOut) return { kind: "cannot_send", reason: "opted_out" };

  const claimResult = await claimSendAttempt(devisId, conversationId);
  if (claimResult.outcome === "not_claimed") {
    return { kind: "not_claimed" };
  }

  // Marqueur informatif — n'affecte jamais la sécurité de l'opération.
  await prisma.whatsappConversation.updateMany({
    where: { id: conversationId, state: "awaiting_send_confirmation" },
    data: { state: "sending" },
  });

  if (claimResult.outcome === "already_succeeded") {
    // Meta a déjà accepté le message lors d'une tentative précédente
    // interrompue avant la finalisation — on ne renvoie rien, on finalise.
    await finalizeSentDevis(devisId, conversationId);
    return { kind: "sent", number: devis.number, clientName: devis.client.name };
  }

  const send = claimResult.send;

  // 1. Génération PDF — aucun appel Meta avant cette étape. Même moteur
  // que les factures/avoirs (lib/pdf/generate-document-pdf.ts).
  let pdfBuffer: Buffer;
  try {
    const settings = await prisma.settings.findUnique({ where: { userId } });
    pdfBuffer = generateDevisPdfBuffer(devis, devis.lines, devis.client, settings);
  } catch (err) {
    await markFailedAndMaybeEscalate(send, userId, devis.number, `Échec génération PDF : ${errMessage(err)}`);
    return { kind: "failed" };
  }

  // 2. Upload média — aucun message envoyé au client à ce stade.
  let mediaId: string;
  try {
    const upload = await uploadWhatsappMedia(pdfBuffer, `devis-${devis.number}.pdf`, "application/pdf");
    mediaId = upload.mediaId;
  } catch (err) {
    await markFailedAndMaybeEscalate(send, userId, devis.number, `Échec upload média : ${errMessage(err)}`);
    return { kind: "failed" };
  }

  // 3. Envoi du document — point de non-retour métier.
  let externalMessageId: string | null;
  try {
    const result = await sendWhatsappDocument(phone, mediaId, `devis-${devis.number}.pdf`, `Devis ${devis.number}`);
    externalMessageId = result.messageId;
  } catch (err) {
    await markFailedAndMaybeEscalate(send, userId, devis.number, `Échec envoi document : ${errMessage(err)}`);
    return { kind: "failed" };
  }

  if (!externalMessageId) {
    // Meta a répondu succès sans identifiant exploitable : impossible de
    // prouver/dédupliquer l'envoi plus tard — traité en échec retryable
    // plutôt que faussement déclaré réussi.
    await markFailedAndMaybeEscalate(send, userId, devis.number, "Réponse Meta sans identifiant de message exploitable");
    return { kind: "failed" };
  }

  // 4. Checkpoint critique : la preuve d'envoi est persistée AVANT toute
  // autre opération. Si le process s'arrête juste après cette ligne
  // (crash, timeout Vercel), un retry verra claimSendAttempt renvoyer
  // "already_succeeded" et ne renverra jamais un second document.
  await markSendSuccess(send.id, externalMessageId);

  // 5. Finalisation — peut échouer sans risque de double-envoi : le
  // checkpoint ci-dessus est déjà durablement posé.
  await finalizeSentDevis(devisId, conversationId);

  return { kind: "sent", number: devis.number, clientName: devis.client.name };
}

async function finalizeSentDevis(devisId: string, conversationId: string): Promise<void> {
  await prisma.devis.updateMany({
    where: { id: devisId, status: { not: "envoye" } },
    data: { status: "envoye", sentAt: new Date() },
  });
  await prisma.whatsappConversation.updateMany({
    where: { id: conversationId },
    data: { state: "idle", pendingDevis: Prisma.DbNull },
  });
}
