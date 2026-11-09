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
//
// Échéance (décision utilisateur, 2026-11-09) : une facture dont l'échéance
// est POSTÉRIEURE à sa date d'émission n'affiche jamais « à réception » ; la
// date d'échéance est imprimée à la place (art. L.441-9 : date à laquelle le
// règlement doit intervenir). Des conditions personnalisées compatibles
// (« Paiement par virement… ») sont conservées après cette date ; celles qui
// parlent de réception sont écartées pour cette facture. Toutes les autres
// mentions (escompte, pénalités, 40 euros, réserve de propriété) restent.
import { formatJourFr, jourEcheance, jourParis } from "@/lib/dates/paris";

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

// « réception », « reception », « à réception de facture »…
const MENTIONNE_RECEPTION = /r[ée]ception/i;

export interface EcheanceDocument {
  /** Date d'émission (instant) ; jour de Paris retenu. */
  issuedAt?: Date | string | null;
  /** Échéance (instant enregistré, ou AAAA-MM-JJ d'un formulaire). */
  dueDate?: Date | string | null;
}

/** Jour d'échéance AAAA-MM-JJ si elle est postérieure au jour d'émission, sinon null. */
export function echeanceUlterieure(doc: EcheanceDocument): string | null {
  if (!doc.dueDate || !doc.issuedAt) return null;
  const due = jourEcheance(doc.dueDate);
  return due > jourParis(doc.issuedAt) ? due : null;
}

/**
 * Conditions de paiement imprimées sur une facture (et prévisualisées dans les
 * formulaires) : SEULE règle, partagée par le PDF, l'impression, l'email et
 * les écrans de saisie de l'échéance.
 */
export function conditionsPaiement(
  settings: Pick<LegalMentionSettings, "conditionsPaiement"> | null | undefined,
  doc: EcheanceDocument = {}
): string {
  const personnalisees = filled(settings?.conditionsPaiement);
  const due = echeanceUlterieure(doc);
  if (!due) return personnalisees ?? CONDITIONS_DEFAUT;
  const echeance = `Date d'échéance du paiement : ${formatJourFr(due)}.`;
  return personnalisees && !MENTIONNE_RECEPTION.test(personnalisees) ? `${echeance} ${personnalisees}` : echeance;
}

export function documentLegalMentions(
  kind: LegalMentionKind,
  settings: LegalMentionSettings | null | undefined,
  opts: { validityDays?: number } & EcheanceDocument = {}
): string {
  // Un avoir ne donne lieu à aucun paiement du client : pas de conditions.
  if (kind === "avoir") return "";

  const parts: string[] = [];
  if (kind === "devis" && opts.validityDays) {
    parts.push(
      `Devis valable ${opts.validityDays} jour${opts.validityDays > 1 ? "s" : ""} à compter de sa date d'émission.`
    );
  }
  // Devis : pas d'échéance (elle est fixée sur la facture) → conditions telles
  // que saisies. Facture : date d'échéance si elle est postérieure à l'émission.
  parts.push(kind === "facture" ? conditionsPaiement(settings, opts) : filled(settings?.conditionsPaiement) ?? CONDITIONS_DEFAUT);
  parts.push(ESCOMPTE);
  parts.push(filled(settings?.penalitesRetard) ?? PENALITES_DEFAUT);
  if (settings?.reservePropriete) parts.push(RESERVE_PROPRIETE);
  if (kind === "devis") {
    parts.push("Pour accepter ce devis, veuillez nous contacter ou signer et retourner ce document.");
  }
  return parts.join(" ");
}
