// Mentions légales imprimées en pied des devis et factures — SEULE source,
// utilisée par le PDF serveur (lib/pdf/generate-document-pdf.ts) et par les
// pages d'impression (app/print/*). Module pur : importable côté client.
//
// Réglages pris en compte (Paramètres → Mentions légales) :
//   - conditionsPaiement : conditions de règlement (défaut « à réception ») ;
//   - penalitesRetard    : taux des pénalités et indemnité forfaitaire de 40 € ;
//   - reservePropriete   : clause de réserve de propriété, si cochée.
// Mention d'escompte toujours présente (obligatoire sur une facture,
// art. L.441-9 du Code de commerce).
// Les PDF utilisent les polices standard de jsPDF : « euros » en toutes
// lettres plutôt que le symbole.

export const PENALITES_DEFAUT =
  "En cas de retard de paiement, une pénalité égale à 3 fois le taux d'intérêt légal sera " +
  "exigée conformément à l'article L.441-10 du Code de commerce, ainsi qu'une indemnité " +
  "forfaitaire de 40 euros pour frais de recouvrement (art. D.441-5).";

export const CONDITIONS_DEFAUT = "Règlement à réception de facture.";

export const ESCOMPTE = "Aucun escompte accordé pour paiement anticipé.";

export const RESERVE_PROPRIETE =
  "Clause de réserve de propriété : les biens restent la propriété du vendeur jusqu'au " +
  "paiement intégral du prix (loi n° 80-335 du 12 mai 1980).";

export interface LegalMentionSettings {
  conditionsPaiement?: string | null;
  penalitesRetard?: string | null;
  reservePropriete?: boolean | null;
}

export type LegalMentionKind = "devis" | "facture" | "avoir";

const filled = (text: string | null | undefined) => (text?.trim() ? text.trim() : null);

export function documentLegalMentions(
  kind: LegalMentionKind,
  settings: LegalMentionSettings | null | undefined,
  opts: { validityDays?: number } = {}
): string {
  // Un avoir ne donne lieu à aucun paiement du client : pas de conditions.
  if (kind === "avoir") return "";

  const parts: string[] = [];
  if (kind === "devis" && opts.validityDays) {
    parts.push(
      `Devis valable ${opts.validityDays} jour${opts.validityDays > 1 ? "s" : ""} à compter de sa date d'émission.`
    );
  }
  parts.push(filled(settings?.conditionsPaiement) ?? CONDITIONS_DEFAUT);
  parts.push(ESCOMPTE);
  parts.push(filled(settings?.penalitesRetard) ?? PENALITES_DEFAUT);
  if (settings?.reservePropriete) parts.push(RESERVE_PROPRIETE);
  if (kind === "devis") {
    parts.push("Pour accepter ce devis, veuillez nous contacter ou signer et retourner ce document.");
  }
  return parts.join(" ");
}
