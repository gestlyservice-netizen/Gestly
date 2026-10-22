import { prisma } from "@/lib/prisma";
import { normalizePhoneE164 } from "@/lib/phone";
import { escalateToArtisan } from "@/lib/whatsapp/escalation";

// Mécanisme 2, isolé : STOP d'un client final envers les communications
// Gestly, reçu depuis un numéro qui n'est identifié comme AUCUN artisan
// (cf. lib/whatsapp/identify.ts, déjà vérifié par l'appelant — ce module ne
// s'exécute jamais pour un numéro d'artisan connu).
//
// Question d'architecture posée par le cahier des charges : un client final
// peut-il répondre sur le même numéro Gestly et être distingué sans
// ambiguïté d'un artisan ? Réponse : OUI pour la distinction
// artisan/client (User.phone vs Client.phone sont deux tables disjointes,
// déjà vérifié en amont par le webhook). En revanche, un numéro de
// téléphone n'est PAS un identifiant unique global dans Gestly : rien
// n'empêche deux artisans différents d'avoir chacun un Client avec le même
// numéro (coïncidence, même personne cliente de deux artisans locaux...).
// Ce module traite donc explicitement trois cas, jamais mélangés :
//   1. Le numéro correspond à UN SEUL Client, chez un seul artisan :
//      résolution sûre, opt-out appliqué directement.
//   2. Le numéro correspond à PLUSIEURS Client, mais tous chez LE MÊME
//      artisan (doublons dans son propre CRM) : ambiguïté interne, jamais
//      résolue automatiquement, mais peut être signalée à CET artisan sans
//      risque de fuite inter-sociétés (tout reste dans ses propres données).
//   3. Le numéro correspond à des Client de PLUSIEURS artisans différents :
//      isolation inter-sociétés prioritaire — AUCUNE modification, ET
//      aucune notification ciblée (notifier un artisan en particulier
//      révélerait que ce numéro est aussi client d'un autre artisan).
//      Journal serveur uniquement, à charge d'une intervention manuelle.
export type ClientStopResolution =
  | { kind: "unique_client"; clientId: string; userId: string }
  | { kind: "same_tenant_ambiguous"; userId: string; candidateIds: string[] }
  | { kind: "cross_tenant_ambiguous"; candidateCount: number }
  | { kind: "no_match" };

export async function resolveClientStop(rawPhone: string): Promise<ClientStopResolution> {
  const target = normalizePhoneE164(rawPhone);
  // Recherche volontairement non filtrée par userId : à ce stade, on ne sait
  // justement pas encore à quel artisan ce numéro appartient. Même approche
  // que lib/whatsapp/identify.ts pour la résolution artisan — à revoir avec
  // un index dédié si le volume de clients devient significatif.
  const candidates = await prisma.client.findMany({ where: { phone: { not: null } } });
  const matches = candidates.filter((c) => c.phone && normalizePhoneE164(c.phone) === target);

  if (matches.length === 0) return { kind: "no_match" };

  const distinctUserIds = new Set(matches.map((c) => c.userId));

  if (distinctUserIds.size > 1) {
    return { kind: "cross_tenant_ambiguous", candidateCount: matches.length };
  }

  if (matches.length === 1) {
    return { kind: "unique_client", clientId: matches[0].id, userId: matches[0].userId };
  }

  return { kind: "same_tenant_ambiguous", userId: matches[0].userId, candidateIds: matches.map((c) => c.id) };
}

export async function applyClientOptOut(clientId: string): Promise<void> {
  await prisma.client.update({ where: { id: clientId }, data: { whatsappOptOut: true } });
}

// Point d'entrée unique appelé par le webhook pour un STOP reçu d'un numéro
// inconnu en tant qu'artisan. Ne crée jamais de WhatsappConversation ni de
// WhatsappMessage pour ce numéro (aucune donnée métier fabriquée pour un
// expéditeur qui n'est identifié comme personne) — seule une fiche Client
// déjà existante peut être modifiée, jamais créée ici.
export async function handleClientStopFromUnknownSender(rawPhone: string): Promise<void> {
  const resolution = await resolveClientStop(rawPhone);

  if (resolution.kind === "unique_client") {
    await applyClientOptOut(resolution.clientId);
    console.info(
      `[whatsapp/client-optout] client ${resolution.clientId} désinscrit des communications WhatsApp (STOP, résolution non ambiguë)`
    );
    return;
  }

  if (resolution.kind === "same_tenant_ambiguous") {
    console.warn(
      `[whatsapp/client-optout] STOP reçu d'un numéro correspondant à plusieurs fiches client chez le même artisan ${resolution.userId} — aucune modification automatique`
    );
    await escalateToArtisan(
      resolution.userId,
      "client_ambigu_stop",
      rawPhone,
      "Un client a répondu STOP à un message WhatsApp, mais son numéro correspond à plusieurs fiches dans votre liste de clients. Vérifiez et fusionnez les doublons si nécessaire, puis désinscrivez la bonne fiche manuellement."
    );
    return;
  }

  if (resolution.kind === "cross_tenant_ambiguous") {
    console.warn(
      `[whatsapp/client-optout] STOP reçu d'un numéro ambigu entre plusieurs sociétés (${resolution.candidateCount} fiches correspondantes) — aucune action automatique, aucune notification ciblée`
    );
    return;
  }

  console.info("[whatsapp/client-optout] STOP reçu d'un numéro inconnu (ni artisan, ni client) — ignoré");
}
