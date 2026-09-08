import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isSubscriptionBlocked } from "@/lib/auth";
import { normalizePhoneE164 } from "@/lib/phone";
import { isValidMetaSignature } from "@/lib/whatsapp/verify-signature";
import { resolveUserByPhone } from "@/lib/whatsapp/identify";
import { MetaMessage, MetaWebhookPayload, type MetaMessageT } from "@/lib/whatsapp/meta-types";

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

  // Numéro inconnu : aucune conversation, aucun message, aucune donnée
  // métier créée pour un utilisateur qui n'existe pas. Journal minimal
  // uniquement (numéro tronqué serait préférable en prod avec un vrai
  // logger ; conservé tel quel ici pour rester simple en V1).
  if (!user) {
    console.info(`[whatsapp/webhook] numéro inconnu (${senderPhone}) — ignoré sans persistance`);
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

  const content =
    message.type === "text"
      ? (message.text?.body ?? "")
      : message.type === "audio"
        ? `[audio:${message.audio?.id ?? "inconnu"}]`
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
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Dédoublonnage : ce message (wamid) a déjà été reçu et traité —
      // retry Meta ou webhook appelé deux fois. On ne recrée rien.
      console.info(`[whatsapp/webhook] message ${message.id} déjà connu (doublon) — ignoré`);
      return;
    }
    throw err;
  }

  const isProcessableType = message.type === "text" || message.type === "audio";

  if (conversation.optedOut) {
    console.info(`[whatsapp/webhook] conversation en opt-out pour l'utilisateur ${user.id} — message persisté sans job`);
    return;
  }

  if (!isProcessableType) {
    console.info(`[whatsapp/webhook] type de message non pris en charge (${message.type}) — persisté sans job`);
    return;
  }

  await prisma.whatsappJob.create({
    data: { messageId: whatsappMessage.id, status: "pending" },
  });
}
