import { prisma } from "@/lib/prisma";

// Mécanisme 1, isolé des trois autres (opt-out client final, plafond IA,
// escalade) : STOP / START de l'artisan envers le bot Gestly. Ce module ne
// fait que détecter les mots-clés et appliquer/lever l'opt-out — jamais
// d'appel IA, jamais de logique métier de devis.
//
// Détection strictement au mot-clé isolé (message réduit à "stop"/"start",
// ponctuation finale ignorée) : une phrase qui contient "stop" au milieu
// d'un message plus long ("il faut stopper le chantier") n'est jamais
// interprétée comme une commande, pour éviter tout faux positif sur un
// message métier normal.
function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?…]+$/, "");
}

export function isStopCommand(text: string): boolean {
  return normalizeCommand(text) === "stop";
}

export function isStartCommand(text: string): boolean {
  return normalizeCommand(text) === "start";
}

export async function disableArtisanBot(conversationId: string): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { optedOut: true },
  });
}

export async function enableArtisanBot(conversationId: string): Promise<void> {
  await prisma.whatsappConversation.update({
    where: { id: conversationId },
    data: { optedOut: false },
  });
}

// Affordance pour une future réactivation depuis les paramètres Gestly (hors
// conversation WhatsApp elle-même) : réactive toutes les conversations
// actuellement en opt-out pour cet utilisateur. Retourne le nombre de
// conversations réactivées.
export async function enableArtisanBotForUser(userId: string): Promise<number> {
  const result = await prisma.whatsappConversation.updateMany({
    where: { userId, optedOut: true },
    data: { optedOut: false },
  });
  return result.count;
}
