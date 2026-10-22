import type { LanguageModel } from "ai";
import { prisma } from "@/lib/prisma";
import { resolveExtractionResult } from "@/lib/whatsapp/extraction-checkpoint";
import { resolveClient } from "@/lib/whatsapp/client-resolution";
import { confirmDevisCreation } from "@/lib/whatsapp/confirm-creation";
import { CreateDevisError } from "@/lib/devis/create-devis";
import { CreateClientError } from "@/lib/clients/create-client";
import { sendDevisToClient } from "@/lib/whatsapp/send-devis";
import { normalizePhoneE164 } from "@/lib/phone";
import { escalateToArtisan } from "@/lib/whatsapp/escalation";
import {
  buildReplyForIntent,
  buildAmbiguousConfirmationReply,
  buildCreationDeclinedReply,
  buildDevisCreatedReply,
  buildCreationFailedReply,
  buildInsufficientDataForCreationReply,
  buildSendConfirmationQuestion,
  buildSendAmbiguousReply,
  buildSendDeclinedReply,
  buildDevisSentReply,
  buildCannotSendReply,
  buildSendFailedReply,
  buildEscalationReply,
  buildRecapReply,
} from "@/lib/whatsapp/reply-builder";
import {
  emptyPendingDevis,
  applyExtractionToPendingDevis,
  applyStuckTracking,
  computeNextState,
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
  // Id du WhatsappMessage entrant à l'origine de ce tour (texte, ou audio
  // déjà transcrit) — clé du checkpoint d'idempotence de l'extraction
  // (étape 8bis, cf. lib/whatsapp/extraction-checkpoint.ts). Un retry du
  // même message réutilise son résultat ; un nouveau message (nouvel id)
  // déclenche toujours une nouvelle extraction.
  messageId: string,
  messageContent: string,
  opts: { model?: LanguageModel | string } = {}
): Promise<string> {
  const conversationRow = await prisma.whatsappConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const currentPendingDevis: PendingDevis =
    (conversationRow.pendingDevis as unknown as PendingDevis) ?? emptyPendingDevis();

  // Règle de rejeu : un message ne peut agir que sur l'état qui existait
  // quand il a été REÇU. La reprise d'un ancien message (retry de job après
  // une erreur en aval) ne doit jamais valoir confirmation d'une étape
  // apparue après lui. On compare donc l'horodatage du message entrant à
  // celui de l'étape concernée (création du devis, début de l'envoi).
  const incoming = await prisma.whatsappMessage.findUnique({ where: { id: messageId } });
  const receivedBeforeOrAt = (marker: Date | null | undefined): boolean =>
    !incoming || !marker || incoming.createdAt.getTime() <= marker.getTime();

  // Idempotence de lecture : si le devis lié à cette conversation est déjà
  // envoyé et que CE message a été reçu avant l'envoi (rejeu du message de
  // confirmation d'envoi, doublon), on ne relance rien — on rappelle la
  // confirmation déjà connue. Un message reçu APRÈS l'envoi est une nouvelle
  // demande : il suit le parcours normal (nouveau brouillon), sans quoi la
  // conversation resterait bloquée sur ce devis pour toujours.
  if (conversationRow.lastCreatedDevisId) {
    const devis = await prisma.devis.findUnique({
      where: { id: conversationRow.lastCreatedDevisId },
      include: { client: true },
    });
    if (devis?.status === "envoye") {
      const send = await prisma.whatsappSend.findUnique({ where: { devisId: devis.id } });
      if (receivedBeforeOrAt(send?.createdAt ?? devis.sentAt)) {
        return buildDevisSentReply(devis.number, devis.client.name);
      }
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
  // conversation restent intacts pour un retry ultérieur. Si un résultat
  // valide existe déjà pour ce messageId (retry après un échec plus loin
  // dans le pipeline), resolveExtractionResult le réutilise directement
  // sans jamais rappeler le modèle (étape 8bis).
  const raw = await resolveExtractionResult(
    messageId,
    { userId, message: messageContent, recentHistory, currentPendingDevis },
    opts
  );

  // ── Gestion spécifique de la confirmation d'ENVOI (étape 6) ────────────
  if (SENDING_STATES.has(conversationRow.state) && conversationRow.lastCreatedDevisId) {
    const devisId = conversationRow.lastCreatedDevisId;
    const devis = await prisma.devis.findUnique({ where: { id: devisId }, include: { client: true } });

    // Rejeu du message qui a confirmé la CRÉATION (reçu avant le devis) :
    // son « oui » portait sur la création, jamais sur l'envoi. Sans cette
    // garde, la reprise du job après une erreur en aval enverrait le devis
    // au client sans que l'artisan l'ait demandé.
    if (devis && receivedBeforeOrAt(devis.createdAt)) {
      return buildDevisCreatedReply(devis.number, devis.client.name, devis.totalTTC);
    }

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
    if (!devis) return buildSendFailedReply();
    const phone = devis.client.phone ? normalizePhoneE164(devis.client.phone) : "(numéro inconnu)";
    return raw.intent === "confirmation"
      ? buildSendAmbiguousReply(devis.number, devis.client.name, phone)
      : buildSendConfirmationQuestion(devis.number, devis.client.name, phone);
  }

  // ── Gestion spécifique de la confirmation de CRÉATION (étape 5) ────────
  if (conversationRow.state === "awaiting_creation_confirmation" && raw.intent === "confirmation") {
    if (raw.reponseConfirmation === "oui") {
      let outcome;
      try {
        outcome = await confirmDevisCreation(conversationId, userId, currentPendingDevis);
      } catch (err) {
        // Erreurs MÉTIER déterministes (client supprimé entre-temps, nom
        // invalide...) : les rejouer échouerait toujours, et l'artisan
        // n'aurait jamais de réponse. On répond clairement à la place.
        // confirmDevisCreation a déjà tout annulé et remis la conversation
        // en attente de confirmation. Les erreurs techniques (base...)
        // remontent toujours pour un retry automatique du job.
        const failure = await handleCreationError(err, conversationId, currentPendingDevis);
        if (failure !== null) return failure;
        throw err;
      }

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

  // ── Reprise après un refus de création ────────────────────────────────
  // Après « non », la conversation repasse en collecte avec un brouillon
  // pourtant complet. Un « oui » ultérieur (« finalement c'est bon ») ne
  // doit pas répondre qu'il manque des informations : on repropose le
  // récapitulatif et on attend une confirmation explicite, sans rien créer.
  if (
    raw.intent === "confirmation" &&
    raw.reponseConfirmation === "oui" &&
    conversationRow.state === "collecting" &&
    computeNextState(currentPendingDevis) === "awaiting_creation_confirmation"
  ) {
    const resumed: PendingDevis = { ...currentPendingDevis, state: "awaiting_creation_confirmation" };
    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { pendingDevis: resumed as unknown as object, state: resumed.state },
    });
    return buildRecapReply(resumed);
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

// Traduit une erreur métier de création en réponse WhatsApp. Renvoie null
// pour toute autre erreur (technique), qui doit remonter au job.
async function handleCreationError(
  err: unknown,
  conversationId: string,
  pendingDevis: PendingDevis
): Promise<string | null> {
  if (err instanceof CreateClientError) {
    return buildCreationFailedReply("missing_client_name", pendingDevis.client.nomMentionne);
  }
  if (!(err instanceof CreateDevisError)) return null;

  if (err.code === "CLIENT_NOT_FOUND") {
    // Le client identifié n'existe plus (supprimé depuis l'interface web) :
    // on oublie cette correspondance pour qu'une nouvelle confirmation crée
    // un client à partir du nom mentionné, plutôt que d'échouer à nouveau.
    const reset: PendingDevis = {
      ...pendingDevis,
      client: { ...pendingDevis.client, matchedClientId: null, matchStatus: "no_match", ambiguousCandidates: [] },
    };
    await prisma.whatsappConversation.update({
      where: { id: conversationId },
      data: { pendingDevis: reset as unknown as object },
    });
    return buildCreationFailedReply("client_not_found", pendingDevis.client.nomMentionne);
  }
  return buildCreationFailedReply(err.code === "NO_LINES" ? "no_lines" : "missing_client_name", pendingDevis.client.nomMentionne);
}
