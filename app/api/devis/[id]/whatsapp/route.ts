import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { devisPublicLink } from "@/lib/url";

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[\s\-\.]/g, "");
  return digits.startsWith("0") ? "+33" + digits.slice(1) : digits;
}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const WA_TOKEN    = process.env.WHATSAPP_TOKEN;
    const WA_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

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

    const to     = normalizePhone(devis.client.phone);
    const amount = devis.totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const link   = devisPublicLink(devis.id);

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
          type: "template",
          template: {
            name: "devis_client",
            language: { code: "fr" },
            components: [
              {
                type: "body",
                parameters: [
                  { type: "text", text: devis.client.name },
                  { type: "text", text: devis.number },
                  { type: "text", text: amount },
                  { type: "text", text: link },
                ],
              },
            ],
          },
        }),
      }
    );

    const data = await metaRes.json() as {
      messages?: { id: string }[];
      error?: { message: string; code?: number; type?: string };
    };

    if (!metaRes.ok) {
      const meta = data.error;
      console.error("[POST /api/devis/:id/whatsapp] Meta error:", meta);
      const detail = meta
        ? `[${meta.code ?? metaRes.status}] ${meta.message}`
        : `HTTP ${metaRes.status}`;
      return NextResponse.json({ error: detail }, { status: metaRes.status });
    }

    return NextResponse.json({ success: true, messageId: data.messages?.[0]?.id ?? null });
  } catch (err) {
    console.error("[POST /api/devis/:id/whatsapp]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
