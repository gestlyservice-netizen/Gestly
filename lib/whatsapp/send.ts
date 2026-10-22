import { getGraphConfig } from "@/lib/whatsapp/graph-config";

// Envoi WhatsApp réutilisable — seul point d'appel à l'API Graph Meta pour
// l'envoi de messages (texte ou document). Ne contient aucune logique
// métier : juste le transport. Le token n'est jamais journalisé.

interface MetaSendResponse {
  messages?: { id: string }[];
  error?: { message: string; code?: number };
}

async function postMessage(body: Record<string, unknown>): Promise<{ messageId: string | null }> {
  const { token, phoneNumberId, baseUrl } = getGraphConfig();

  const res = await fetch(`${baseUrl}/${phoneNumberId}/messages`, {
    method: "POST",
    // Chaque envoi WhatsApp est une action réelle avec effet de bord —
    // jamais mise en cache (le fetch patché de Next.js peut sinon rejouer
    // une réponse déjà vue pour une requête de même forme, ce qui
    // reviendrait à ne jamais réellement renvoyer certains messages).
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => null)) as MetaSendResponse | null;

  if (!res.ok) {
    const detail = data?.error ? `[${data.error.code ?? res.status}] ${data.error.message}` : `HTTP ${res.status}`;
    throw new Error(`Échec de l'envoi WhatsApp : ${detail}`);
  }

  return { messageId: data?.messages?.[0]?.id ?? null };
}

export async function sendWhatsappText(to: string, body: string): Promise<{ messageId: string | null }> {
  return postMessage({ messaging_product: "whatsapp", to, type: "text", text: { body } });
}

// Envoi d'un document déjà uploadé (media_id obtenu via
// lib/whatsapp/media.ts) — utilisé pour l'envoi du PDF de devis au client.
export async function sendWhatsappDocument(
  to: string,
  mediaId: string,
  filename: string,
  caption?: string
): Promise<{ messageId: string | null }> {
  return postMessage({
    messaging_product: "whatsapp",
    to,
    type: "document",
    document: { id: mediaId, filename, ...(caption ? { caption } : {}) },
  });
}
