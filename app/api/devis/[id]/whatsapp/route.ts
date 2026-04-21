import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://gestly-iota.vercel.app";
const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\s/g, "");
  return digits.startsWith("0") ? "+33" + digits.slice(1) : digits;
}

function buildMessage(clientName: string, devisNumber: string, amount: string, devisId: string): string {
  const url = `${APP_URL}/d/${devisId}`;
  return [
    `Bonjour ${clientName},`,
    `Votre devis ${devisNumber} d'un montant de ${amount} € est prêt.`,
    `N'hésitez pas à nous contacter pour toute question.`,
    "",
    url,
  ].join("\n");
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    if (!WA_TOKEN || !WA_PHONE_ID) {
      return NextResponse.json(
        { error: "Variables d'environnement WhatsApp manquantes" },
        { status: 503 }
      );
    }

    const devis = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
      include: { client: true },
    });

    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
    if (!devis.client.phone) {
      return NextResponse.json({ error: "Ce client n'a pas de numéro de téléphone" }, { status: 400 });
    }

    const to = normalizePhone(devis.client.phone);
    const amount = devis.totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const message = buildMessage(devis.client.name, devis.number, amount, devis.id);

    const metaRes = await fetch(
      `https://graph.facebook.com/v18.0/${WA_PHONE_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WA_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: { body: message },
        }),
      }
    );

    const data = await metaRes.json() as { messages?: { id: string }[]; error?: { message: string } };

    if (!metaRes.ok) {
      console.error("[POST /api/devis/:id/whatsapp] Meta error:", data.error);
      return NextResponse.json(
        { error: data.error?.message ?? "Erreur Meta API" },
        { status: metaRes.status }
      );
    }

    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id ?? null });
  } catch (err) {
    console.error("[POST /api/devis/:id/whatsapp]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
