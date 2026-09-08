// Envoi WhatsApp réutilisable — un seul point d'appel à l'API Graph Meta
// pour tout le code (orchestrateur, futurs envois de devis/PDF). Ne contient
// aucune logique métier : juste le transport.
//
// L'URL de base est configurable (WHATSAPP_GRAPH_API_BASE_URL) : utile pour
// changer de version d'API sans redéploiement de code, et permet de router
// vers un transport simulé en tests sans jamais contacter Meta.
const GRAPH_API_BASE_URL = process.env.WHATSAPP_GRAPH_API_BASE_URL ?? "https://graph.facebook.com/v18.0";

export async function sendWhatsappText(to: string, body: string): Promise<{ messageId: string | null }> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("Variables d'environnement WhatsApp manquantes (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  const res = await fetch(`${GRAPH_API_BASE_URL}/${phoneNumberId}/messages`, {
    method: "POST",
    // Chaque envoi WhatsApp est une action réelle avec effet de bord — jamais
    // mise en cache. Sans ce réglage explicite, le fetch patché de Next.js
    // peut mettre en cache/rejouer une réponse déjà vue pour une requête de
    // même forme, ce qui reviendrait à ne jamais réellement renvoyer certains
    // messages.
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  const data = (await res.json().catch(() => null)) as
    | { messages?: { id: string }[]; error?: { message: string; code?: number } }
    | null;

  if (!res.ok) {
    const detail = data?.error ? `[${data.error.code ?? res.status}] ${data.error.message}` : `HTTP ${res.status}`;
    throw new Error(`Échec de l'envoi WhatsApp : ${detail}`);
  }

  return { messageId: data?.messages?.[0]?.id ?? null };
}
