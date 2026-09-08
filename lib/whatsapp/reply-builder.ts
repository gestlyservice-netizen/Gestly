import type { PendingDevis } from "@/lib/whatsapp/pending-devis";
import { computeMissingRequirements } from "@/lib/whatsapp/pending-devis";
import type { RawExtraction } from "@/lib/whatsapp/pending-devis";

// Toutes les réponses envoyées à l'artisan sont composées ici, de façon
// déterministe (templates), jamais rédigées par le modèle IA. L'IA ne fait
// que comprendre (lib/whatsapp/extraction.ts) — elle n'écrit jamais le texte
// qui part sur WhatsApp. Ça élimine tout risque d'invention dans la réponse
// elle-même, pas seulement dans les données extraites.

export function buildOffTopicReply(): string {
  return "Je n'ai pas repéré de demande de devis dans ce message. Décrivez-moi le client et les prestations quand vous voulez, je m'en occupe.";
}

export function buildIncomprehensibleReply(): string {
  return "Je n'ai pas bien compris. Vous pouvez reformuler ? Par exemple : « Devis pour M. Dupont, peinture salon, 500€ ».";
}

export function buildCancelledReply(): string {
  return "D'accord, j'annule ce brouillon de devis. Décrivez-m'en un nouveau quand vous voulez.";
}

export function buildMultipleDevisReply(): string {
  return "On dirait que vous décrivez plusieurs devis différents. Je ne peux en préparer qu'un à la fois pour l'instant — lequel voulez-vous que je prépare en premier ?";
}

export function buildNotReadyConfirmationReply(): string {
  return "Il me manque encore des informations avant de pouvoir vous montrer un récapitulatif. Décrivez-moi le client et les prestations.";
}

// (aucune fonction de placeholder de création ici — la création réelle est
// gérée par lib/whatsapp/confirm-creation.ts, orchestrée depuis
// conversation-turn.ts)

export function buildAmbiguousConfirmationReply(pendingDevis: PendingDevis): string {
  return `Je n'ai pas compris si c'est oui ou non. ${buildRecapReply(pendingDevis)}`;
}

export function buildCreationDeclinedReply(): string {
  return "D'accord, je ne crée rien pour l'instant. Qu'est-ce qu'il faut changer dans le devis ?";
}

export function buildDevisCreatedReply(number: string, clientName: string, totalTTC: number): string {
  return [
    `Le devis ${number} pour ${clientName}, montant ${round2(totalTTC)} € TTC, a été créé.`,
    "Il n'est pas encore envoyé au client.",
    "Voulez-vous que je l'envoie maintenant ?",
  ].join(" ");
}

export function buildInsufficientDataForCreationReply(missing: string[]): string {
  return `Il manque encore des informations pour créer ce devis : ${missing.join(", ")}.`;
}

export function buildClarificationReply(pendingDevis: PendingDevis): string {
  const missing = computeMissingRequirements(pendingDevis);
  const points: string[] = [];

  if (pendingDevis.client.matchStatus === "ambiguous") {
    const names = pendingDevis.client.ambiguousCandidates
      .map((c) => `${c.name}${c.phone ? ` (${c.phone})` : ""}`)
      .join(", ");
    points.push(`Plusieurs clients correspondent à « ${pendingDevis.client.nomMentionne} » : ${names}. Lequel ?`);
  } else if (missing.includes("le nom du client")) {
    points.push("Pour qui est ce devis ?");
  }

  if (missing.some((m) => m.startsWith("l'objet"))) {
    points.push("Quel est l'objet des travaux ?");
  }

  if (missing.some((m) => m.startsWith("au moins une prestation") || m.startsWith("le prix"))) {
    points.push("Quelles prestations et à quel prix ?");
  }

  for (const ambiguite of pendingDevis.ambiguitesOuvertes) {
    points.push(ambiguite);
  }

  if (points.length === 0) {
    return buildNotReadyConfirmationReply();
  }

  // Messages courts adaptés à WhatsApp : on regroupe, on ne pose jamais
  // plus de 2-3 questions dans un même message.
  const grouped = points.slice(0, 3).join(" ");
  return grouped;
}

export function buildRecapReply(pendingDevis: PendingDevis): string {
  const lines = pendingDevis.lignes
    .map((l) => {
      const qty = l.quantite.value ? `${l.quantite.value}${l.unite.value ? ` ${l.unite.value}` : ""} × ` : "";
      const price = l.prixUnitaire.value !== null ? `${l.prixUnitaire.value}€` : "";
      const total = l.montant.value !== null ? ` = ${l.montant.value}€` : "";
      return `• ${l.description} — ${qty}${price}${total}`.trim();
    })
    .join("\n");

  const totalTTC = pendingDevis.lignes.reduce((sum, l) => sum + (l.montant.value ?? 0), 0);

  return [
    "Voici le récapitulatif du devis :",
    `Client : ${pendingDevis.client.nomMentionne ?? "(non précisé)"}`,
    pendingDevis.objet.value ? `Objet : ${pendingDevis.objet.value}` : null,
    lines,
    `Total estimé : ${round2(totalTTC)}€`,
    "",
    "Je crée ce devis ? Répondez OUI pour confirmer, ou dites-moi ce qu'il faut changer.",
  ]
    .filter(Boolean)
    .join("\n");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Utilisé pour le cas général (hors gestion spécifique de la confirmation de
// création/envoi, qui a sa propre orchestration dans conversation-turn.ts
// une fois qu'un brouillon est prêt). Ici, "confirmation" ne peut arriver
// que hors contexte (aucune confirmation en attente).
export function buildReplyForIntent(pendingDevis: PendingDevis, raw: RawExtraction): string {
  if (raw.intent === "hors_sujet") return buildOffTopicReply();
  if (raw.intent === "incomprehensible") return buildIncomprehensibleReply();
  if (raw.intent === "annulation") return buildCancelledReply();
  if (raw.plusieursDevisDetectes) return buildMultipleDevisReply();
  if (raw.intent === "confirmation") return buildNotReadyConfirmationReply();
  return pendingDevis.state === "awaiting_creation_confirmation"
    ? buildRecapReply(pendingDevis)
    : buildClarificationReply(pendingDevis);
}
