import type { LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { extractDevisInfo } from "@/lib/whatsapp/extraction";
import { resolveClient } from "@/lib/whatsapp/client-resolution";
import { confirmDevisCreation } from "@/lib/whatsapp/confirm-creation";
import { sendDevisToClient } from "@/lib/whatsapp/send-devis";
import { normalizePhoneE164 } from "@/lib/phone";
import { escalateToArtisan } from "@/lib/whatsapp/escalation";
import {
  buildReplyForIntent,
  buildAmbiguousConfirmationReply,
  buildCreationDeclinedReply,
  buildDevisCreatedReply,
  buildInsufficientDataForCreationReply,
  buildSendConfirmationQuestion,
  buildSendAmbiguousReply,
  buildSendDeclinedReply,
  buildDevisSentReply,
  buildCannotSendReply,
  buildSendFailedReply,
  buildEscalationReply,
} from "@/lib/whatsapp/reply-builder";
import {
  emptyPendingDevis,
  applyExtractionToPendingDevis,
  applyStuckTracking,
  type PendingDevis,
} from "@/lib/whatsapp/pending-devis";
import { DEFAULT_TVA_RATE } from "@/lib/ai/config";

const SENDING_STATES = new Set(["awaiting_send_confirmation", "sending"]);

// Mécanisme 4 (escalade), appliqué uniquement à la boucle générale de
// clarification (hors_sujet/incomprehensible répétés) — cf.
// lib/whatsapp/pending-devis.ts pour le raisonnement complet. Les boucles de
// confirmation ambiguë (création/envoi) ne sont pas couvertes par ce
// compteur pour l'instant — limitation connue, documentée dans le rapport
// de fin d'étape plutôt que silencieusement ignorée.
const MAX_STUCK_TURNS = 3;

// Orchestration complète d'un tour de conversation texte : comprendre,
// compléter, confirmer la création, créer le devis, confirmer l'envoi,
// générer le PDF et envoyer au client. Chaque étape ne progresse que sur
// confirmation explicite et non ambiguë de l'artisan.
export async function processTextMessage(
  conversationId: string,
  userId: string,
  messageContent: string,
  opts: { model?: LanguageModel | string } = {}
): Promise<string> {
  const conversationRow = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const currentPendingDevis: PendingDevis =
    (conversationRow.pendingDevis as unknown as PendingDevis) ?? emptyPendingDevis();

  // Idempotence de lecture stricte : si le devis lié à cette conversation
  // est déjà réellement envoyé, on ne relance jamais rien (extraction,
  // création, envoi) — on rappelle juste la confirmation déjà connue, quel
  // que soit le message reçu (rejeu, message en double, artisan qui répond
  // encore après coup...).
  if (conversationRow.lastCreatedDevisId) {
    const devis = await prisma.devis.findUnique({
      where: { id: conversationRow.lastCreatedDevisId },
      include: { client: true },
    });
    if (devis?.status === "envoye") {
      return buildDevisSentReply(devis.number, devis.client.name);
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
  const raw = await extractDevisInfo(
    { userId, message: messageContent, recentHistory, currentPendingDevis },
    opts
  );

  // ── Gestion spécifique de la confirmation d'ENVOI (étape 6) ────────────
  if (SENDING_STATES.has(conversationRow.state) && conversationRow.lastCreatedDevisId) {
    const devisId = conversationRow.lastCreatedDevisId;

    if (raw.intent === "confirmation" && raw.reponseConfirmation === "oui") {
      const outcome = await sendDevisToClient(conversationId, userId);

      if (outcome.kind === "sent" || outcome.kind === "already_sent") {
        return buildDevisSentReply(outcome.number, outcome.clientName);
      }
      if (outcome.kind === "cannot_send") {
        return buildCannotSendReply(outcome.reason);
      }
      if (outcome.kind === "failed") {
        return buildSendFailedReply();
      }
      // "not_claimed" : un autre traitement a déjà la main ou a déjà conclu
      // — on relit l'état réel sans jamais retenter d'appel Meta ici.
      const freshDevis = await prisma.devis.findUnique({ where: { id: devisId }, include: { client: true } });
      if (freshDevis?.status === "envoye") return buildDevisSentReply(freshDevis.number, freshDevis.client.name);
      return buildSendFailedReply();
    }

    if (raw.intent === "confirmation" && raw.reponseConfirmation === "non") {
      // Le devis reste créé, on sort simplement de la tentative d'envoi —
      // l'artisan pourra redemander l'envoi plus tard (état inchangé).
      return buildSendDeclinedReply();
    }

    // Toute autre réponse (ambiguë, hors sujet, nouvelle description...) ne
    // déclenche jamais d'envoi : on redemande clairement, avec le
    // destinataire exact pour éviter toute confusion.
    const devis = await prisma.devis.findUnique({ where: { id: devisId }, include: { client: true } });
    if (!devis) return buildSendFailedReply();
    const phone = devis.client.phone ? normalizePhoneE164(devis.client.phone) : "(numéro inconnu)";
    return raw.intent === "confirmation"
      ? buildSendAmbiguousReply(devis.number, devis.client.name, phone)
      : buildSendConfirmationQuestion(devis.number, devis.client.name, phone);
  }

  // ── Gestion spécifique de la confirmation de CRÉATION (étape 5) ────────
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
  const merged = await applyExtractionToPendingDevis(
    currentPendingDevis,
    raw,
    DEFAULT_TVA_RATE,
    (name, phone) => resolveClient(userId, name, phone)
  );

  // ── Mécanisme 4 (escalade), isolé : suivi de blocage conversationnel ────
  const nextPendingDevis = applyStuckTracking(merged, raw, MAX_STUCK_TURNS);
  const justEscalated = nextPendingDevis.escalated && !currentPendingDevis.escalated;

  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { pendingDevis: nextPendingDevis as unknown as object, state: nextPendingDevis.state },
  });

  if (justEscalated) {
    await escalateToArtisan(
      userId,
      "clarification_max",
      nextPendingDevis.draftId,
      "Une conversation WhatsApp semble bloquée : l'assistant n'a pas réussi à comprendre plusieurs messages à la suite pour préparer un devis."
    );
  }
  if (nextPendingDevis.escalated) {
    // Déjà signalé pour ce brouillon — ne relance jamais de nouvelle
    // clarification tant qu'aucune info nouvelle n'a fait progresser le
    // brouillon (cf. applyStuckTracking, qui lève "escalated" dès qu'un
    // message "devis" apporte une vraie progression).
    return buildEscalationReply();
  }

  return buildReplyForIntent(nextPendingDevis, raw);
}
