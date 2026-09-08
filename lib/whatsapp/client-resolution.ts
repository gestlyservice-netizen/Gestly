import { prisma } from "@/lib/prisma";
import { normalizePhoneE164 } from "@/lib/phone";
import type { PendingDevisClient, ClientCandidate } from "@/lib/whatsapp/pending-devis";

// Recherche déterministe dans le CRM Gestly — aucune IA ici. Ne sélectionne
// automatiquement un client que si la correspondance est certaine et unique.
// En cas de doute, retourne "ambiguous" avec les candidats : c'est à
// l'agent de demander à l'artisan de trancher, jamais à ce module de choisir.
export async function resolveClient(
  userId: string,
  nameGiven: string | null,
  phoneGiven: string | null
): Promise<Pick<PendingDevisClient, "matchedClientId" | "matchStatus" | "ambiguousCandidates">> {
  if (!nameGiven && !phoneGiven) {
    return { matchedClientId: null, matchStatus: "not_searched", ambiguousCandidates: [] };
  }

  // Un numéro de téléphone est un identifiant fort : une correspondance
  // exacte sur le téléphone est traitée comme non ambiguë même si plusieurs
  // clients portent un nom proche.
  if (phoneGiven) {
    const normalizedTarget = normalizePhoneE164(phoneGiven);
    const byPhone = await prisma.client.findMany({ where: { userId, phone: { not: null } } });
    const phoneMatches = byPhone.filter((c) => c.phone && normalizePhoneE164(c.phone) === normalizedTarget);
    if (phoneMatches.length === 1) {
      return { matchedClientId: phoneMatches[0].id, matchStatus: "unique_match", ambiguousCandidates: [] };
    }
    if (phoneMatches.length > 1) {
      return {
        matchedClientId: null,
        matchStatus: "ambiguous",
        ambiguousCandidates: toCandidates(phoneMatches),
      };
    }
  }

  if (nameGiven) {
    const normalizedName = normalizeForComparison(nameGiven);
    const candidates = await prisma.client.findMany({ where: { userId } });
    const nameMatches = candidates.filter((c) => normalizeForComparison(c.name) === normalizedName);

    if (nameMatches.length === 1) {
      return { matchedClientId: nameMatches[0].id, matchStatus: "unique_match", ambiguousCandidates: [] };
    }
    if (nameMatches.length > 1) {
      return { matchedClientId: null, matchStatus: "ambiguous", ambiguousCandidates: toCandidates(nameMatches) };
    }

    // Aucune correspondance exacte : on tente une correspondance partielle
    // (ex. "Dupont" mentionné, client enregistré "Jean Dupont") seulement
    // pour PROPOSER des candidats en cas d'ambiguïté, jamais pour choisir
    // automatiquement — une correspondance partielle unique n'est pas
    // considérée fiable à 100%, donc reste "ambiguous" plutôt que
    // "unique_match" si elle est la seule piste disponible.
    const partialMatches = candidates.filter((c) => normalizeForComparison(c.name).includes(normalizedName));
    if (partialMatches.length === 1) {
      return { matchedClientId: null, matchStatus: "ambiguous", ambiguousCandidates: toCandidates(partialMatches) };
    }
    if (partialMatches.length > 1) {
      return { matchedClientId: null, matchStatus: "ambiguous", ambiguousCandidates: toCandidates(partialMatches) };
    }
  }

  return { matchedClientId: null, matchStatus: "no_match", ambiguousCandidates: [] };
}

function toCandidates(clients: { id: string; name: string; phone: string | null }[]): ClientCandidate[] {
  return clients.map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
}

function normalizeForComparison(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}
