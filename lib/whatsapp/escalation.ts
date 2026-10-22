import { createNotificationOnce } from "@/lib/notifications";

// Mécanisme 4, isolé : escalade humaine. Ce module ne décide jamais QUAND
// escalader (ça reste la responsabilité de chaque mécanisme/flux appelant :
// conversation-turn.ts pour les clarifications bloquées, client-optout.ts
// pour les STOP client ambigus, voice-message.ts pour les échecs définitifs
// de transcription, send-devis.ts pour les échecs définitifs d'envoi) — il
// se contente d'exposer un point d'entrée unique, sûr et anti-spam pour
// produire la notification interne Gestly correspondante.
//
// Anti-spam : repose sur createNotificationOnce (userId + type + link) —
// `link` encode l'identifiant stable de l'INCIDENT (conversation, devis,
// message, numéro de téléphone), jamais un id de tentative/retry, donc un
// même incident ne produit jamais plus d'une notification, quel que soit le
// nombre de retries qui le traversent.
//
// Confidentialité : `detail` doit toujours être un résumé compréhensible
// pour l'artisan, JAMAIS le contenu brut d'un message, d'une transcription
// ou d'une donnée client sensible au-delà du strict nécessaire.
export type EscalationKind =
  | "clarification_max"
  | "client_ambigu_stop"
  | "transcription_echec"
  | "envoi_echec";

function buildLink(kind: EscalationKind, dedupKey: string): string {
  switch (kind) {
    case "clarification_max":
      return `/dashboard/parametres?whatsapp_stuck=${encodeURIComponent(dedupKey)}`;
    case "client_ambigu_stop":
      return `/dashboard/clients?phone=${encodeURIComponent(dedupKey)}`;
    case "transcription_echec":
      return `/dashboard/parametres?whatsapp_message=${encodeURIComponent(dedupKey)}`;
    case "envoi_echec":
      return `/dashboard/devis/${encodeURIComponent(dedupKey)}`;
  }
}

export async function escalateToArtisan(
  userId: string,
  kind: EscalationKind,
  dedupKey: string,
  detail: string
): Promise<void> {
  await createNotificationOnce(userId, "whatsapp_escalade", detail, buildLink(kind, dedupKey));
}
