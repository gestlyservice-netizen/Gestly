import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSubscriptionBlocked } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/phone";
import { isValidMetaSignature } from "@/lib/whatsapp/verify-signature";
import { resolveUserByPhone } from "@/lib/whatsapp/identify";
import { isStopCommand, isStartCommand } from "@/lib/whatsapp/artisan-optout";
import { handleClientStopFromUnknownSender } from "@/lib/whatsapp/client-optout";
import { MetaMessage, MetaWebhookPayload, type MetaMessageT } from "@/lib/whatsapp/meta-types";
import { processWhatsappJob } from "@/lib/whatsapp/agent";

// Jamais mis en cache, jamais pré-rendu : c'est un endpoint d'intégration
// externe pur.
export const dynamic = "force-dynamic";

// ── GET — vérification d'abonnement du webhook par Meta ─────────────────
// Ne dépend que de WHATSAPP_WEBHOOK_VERIFY_TOKEN (jeton arbitraire choisi
// par nous, distinct de WHATSAPP_APP_SECRET utilisé pour signer le POST).
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ── POST — réception des évènements WhatsApp ─────────────────────────────
// Rôle strictement limité à : vérifier la signature, identifier l'artisan,
// persister le minimum nécessaire et créer un WhatsappJob. Aucune logique
// IA, transcription, création de devis, génération de PDF ou envoi n'a lieu
// ici — c'est le rôle du futur traitement en arrière-plan (WhatsappJob).
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!isValidMetaSignature(rawBody, signature)) {
    console.warn("[whatsapp/webhook] signature invalide ou absente — requête rejetée, rien traité");
    return NextResponse.json({ error: "Signature invalide" }, { status: 403 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    // Corps illisible : on répond 200 pour éviter une tempête de retries
    // Meta sur un payload qu'on ne pourra de toute façon jamais interpréter.
    console.warn("[whatsapp/webhook] corps de requête non-JSON, ignoré");
    return NextResponse.json({ received: true });
  }

  const parsed = MetaWebhookPayload.safeParse(json);
  if (!parsed.success) {
    console.warn("[whatsapp/webhook] structure de payload inattendue, ignorée");
    return NextResponse.json({ received: true });
  }

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const rawMessages = value.messages;
      if (!rawMessages || rawMessages.length === 0) {
        // Pas de "messages" dans cette value : accusés de lecture/livraison
        // (value.statuses) ou autre évènement non lié à un message entrant
        // — ce n'est pas un message utilisateur, rien à faire.
        continue;
      }

      const gestlyNumber = value.metadata?.display_phone_number
        ? normalizePhoneE164(value.metadata.display_phone_number)
        : null;

      for (const rawMessage of rawMessages) {
        const messageParsed = MetaMessage.safeParse(rawMessage);
        if (!messageParsed.success) {
          console.warn("[whatsapp/webhook] message malformé dans le payload, ignoré individuellement");
          continue;
        }
        await handleIncomingMessage(messageParsed.data, gestlyNumber);
      }
    }
  }

  return NextResponse.json({ received: true });
}

async function handleIncomingMessage(message: MetaMessageT, gestlyNumber: string | null): Promise<void> {
  const senderPhone = normalizePhoneE164(message.from);

  // Garde-fou : un message qui semble venir du numéro Gestly lui-même est
  // une anomalie (boucle, mauvaise configuration) — on ne le traite jamais.
  if (gestlyNumber && senderPhone === gestlyNumber) {
    console.warn("[whatsapp/webhook] message reçu depuis le numéro Gestly lui-même — ignoré");
    return;
  }

  const user = await resolveUserByPhone(senderPhone);

  // Numéro inconnu en tant qu'artisan : aucune conversation, aucun message,
  // aucune donnée métier créée. Seule exception (mécanisme 2, étape 8) : un
  // STOP explicite peut correspondre à un Client final déjà connu d'un
  // artisan — cf. lib/whatsapp/client-optout.ts pour la résolution sûre
  // (jamais de conversation/message créés pour autant, uniquement une
  // éventuelle mise à jour de la fiche Client existante).
  if (!user) {
    if (message.type === "text" && isStopCommand(message.text?.body ?? "")) {
      await handleClientStopFromUnknownSender(senderPhone);
    } else {
      console.info(`[whatsapp/webhook] numéro inconnu (${senderPhone}) — ignoré sans persistance`);
    }
    return;
  }

  if (isSubscriptionBlocked(user)) {
    console.info(`[whatsapp/webhook] abonnement inactif/impayé pour l'utilisateur ${user.id} — ignoré sans traitement`);
    return;
  }

  let conversation = await prisma.whatsappConversation.findFirst({
    where: { userId: user.id, phoneNumber: senderPhone },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!conversation) {
    conversation = await prisma.whatsappConversation.create({
      data: { userId: user.id, phoneNumber: senderPhone },
    });
  } else {
    await prisma.whatsappConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // Pour un message vocal, le texte n'existe pas encore : content reste
  // vide, les informations utiles vivent dans des champs dédiés (mediaId,
  // mimeType) plutôt que d'être encodées de façon ambiguë dans content.
  // La transcription elle-même n'a jamais lieu ici (rôle de l'orchestrateur,
  // cf. lib/whatsapp/voice-message.ts).
  const content =
    message.type === "text"
      ? (message.text?.body ?? "")
      : message.type === "audio"
        ? ""
        : `[non_supporte:${message.type}]`;

  let whatsappMessage;
  try {
    whatsappMessage = await prisma.whatsappMessage.create({
      data: {
        conversationId: conversation.id,
        direction: "in",
        type: message.type,
        externalId: message.id,
        content,
        ...(message.type === "audio"
          ? {
              mediaId: message.audio?.id ?? null,
              mimeType: message.audio?.mime_type ?? null,
              transcriptionStatus: "pending",
            }
          : {}),
      },
    });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    // Dédoublonnage : ce message (wamid) a déjà été reçu — retry Meta ou
    // webhook appelé deux fois. On ne recrée jamais le message. Seule
    // exception : le premier passage a enregistré le message mais a échoué
    // AVANT de créer son job (erreur base → réponse 500 → Meta relivre).
    // Sans job, le message ne serait jamais traité : on crée le job manquant.
    const existing = await prisma.whatsappMessage.findUnique({ where: { externalId: message.id } });
    const existingJob = existing ? await prisma.whatsappJob.findUnique({ where: { messageId: existing.id } }) : null;
    if (!existing || existingJob) {
      console.info(`[whatsapp/webhook] message ${message.id} déjà connu (doublon) — ignoré`);
      return;
    }
    console.warn(`[whatsapp/webhook] message ${message.id} déjà enregistré mais sans job (échec précédent) — job créé`);
    whatsappMessage = existing;
  }

  const isProcessableType = message.type === "text" || message.type === "audio";

  // Conversation désactivée (STOP) : silence total, aucun traitement — sauf
  // la commande START, seul moyen de réactiver l'assistant depuis WhatsApp
  // (traitée par l'agent, cf. buildReply dans lib/whatsapp/agent.ts).
  const isStartRequest = message.type === "text" && isStartCommand(message.text?.body ?? "");
  if (conversation.optedOut && !isStartRequest) {
    console.info(`[whatsapp/webhook] conversation en opt-out pour l'utilisateur ${user.id} — message persisté sans job`);
    return;
  }

  if (!isProcessableType) {
    console.info(`[whatsapp/webhook] type de message non pris en charge (${message.type}) — persisté sans job`);
    return;
  }

  let job;
  try {
    job = await prisma.whatsappJob.create({
      data: { messageId: whatsappMessage.id, status: "pending" },
    });
  } catch (err) {
    // Deux livraisons concurrentes du même message : un seul job existe
    // (WhatsappJob.messageId est unique), l'autre livraison s'arrête ici.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }

  // Déclenchement : traitement lancé après la réponse HTTP (waitUntil ne
  // bloque jamais la réponse à Meta), toujours via l'orchestrateur unique
  // (lib/whatsapp/agent.ts) — le webhook ne contient aucune autre logique
  // métier. Filet de sécurité : /api/whatsapp/process-pending (cron) reprend
  // tout job resté pending/failed/bloqué, si ce déclenchement immédiat
  // échoue ou n'aboutit pas (cold start interrompu, etc.).
  waitUntil(processWhatsappJob(job.id));
}
