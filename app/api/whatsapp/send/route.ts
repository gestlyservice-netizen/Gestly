import { NextRequest, NextResponse } from "next/server";

interface SendBody {
  to: string;
  message: string;
}

interface MetaSuccessResponse {
  messages: { id: string }[];
}

interface MetaErrorResponse {
  error: { message: string; code: number };
}

export async function POST(request: NextRequest) {
  try {
    const token           = process.env.WHATSAPP_TOKEN;
    const phoneNumberId   = process.env.WHATSAPP_PHONE_NUMBER_ID;

    if (!token || !phoneNumberId) {
      return NextResponse.json(
        { success: false, error: "Variables d'environnement WhatsApp manquantes (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)" },
        { status: 503 }
      );
    }

    const body = await request.json() as Partial<SendBody>;
    const { to, message } = body;

    if (!to || !message) {
      return NextResponse.json(
        { success: false, error: "Les champs `to` et `message` sont requis" },
        { status: 400 }
      );
    }

    const metaRes = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
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

    const metaData = await metaRes.json() as MetaSuccessResponse & MetaErrorResponse;

    if (!metaRes.ok) {
      const errMsg = metaData.error?.message ?? "Erreur inconnue de l'API Meta";
      console.error("[POST /api/whatsapp/send] Meta error:", metaData.error);
      return NextResponse.json(
        { success: false, error: errMsg },
        { status: metaRes.status }
      );
    }

    const messageId = metaData.messages?.[0]?.id ?? null;
    return NextResponse.json({ success: true, messageId });
  } catch (err) {
    console.error("[POST /api/whatsapp/send]", err);
    return NextResponse.json(
      { success: false, error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
