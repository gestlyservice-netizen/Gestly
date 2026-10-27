// Calcul unique des lignes et totaux des devis et factures, partagé par les
// routes API (création, modification), createDevis (web + WhatsApp) et les
// aperçus des formulaires : le total affiché pendant la saisie est celui
// enregistré, puis imprimé.
//
// Règles :
// - montants en centimes entiers pendant le calcul (aucune dérive de virgule
//   flottante : 3 × 0,10 € = 0,30 €, pas 0,30000000000000004) ;
// - total HT de ligne arrondi au centime ;
// - TVA calculée par taux sur la somme des bases de ce taux, arrondie au
//   centime (présentation habituelle d'une facture) ;
// - TTC = HT + TVA, exactement.
// Les lignes sont validées côté serveur : une requête forgée ne peut plus
// enregistrer de quantité nulle ou négative, de prix négatif, de taux absurde
// ni de NaN (totaux illisibles sur le PDF).

export const DEFAULT_TVA_RATE = 20;

export interface DocumentLineInput {
  description?: unknown;
  quantity?: unknown;
  unitPriceHT?: unknown;
  tvaRate?: unknown;
}

export interface ComputedDocumentLine {
  description: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
  totalHT: number;
}

export interface DocumentTotals {
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
}

export type ComputeDocumentResult =
  | ({ ok: true; lines: ComputedDocumentLine[] } & DocumentTotals)
  | { ok: false; error: string };

const toCents = (euros: number) => Math.round(Number((euros * 100).toFixed(6)));
const fromCents = (cents: number) => cents / 100;

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value.replace(",", "."));
  return NaN;
}

/** Totaux à partir de lignes déjà valides (aperçu de formulaire compris). */
export function computeTotals(lines: { quantity: number; unitPriceHT: number; tvaRate: number }[]): DocumentTotals & { lineTotals: number[] } {
  const lineCents = lines.map((l) => toCents(l.quantity * l.unitPriceHT));
  const baseByRate = new Map<number, number>();
  lines.forEach((l, i) => baseByRate.set(l.tvaRate, (baseByRate.get(l.tvaRate) ?? 0) + lineCents[i]));
  const htCents = lineCents.reduce((a, b) => a + b, 0);
  let tvaCents = 0;
  for (const [rate, base] of Array.from(baseByRate)) tvaCents += Math.round(Number(((base * rate) / 100).toFixed(6)));
  return {
    lineTotals: lineCents.map(fromCents),
    totalHT: fromCents(htCents),
    totalTVA: fromCents(tvaCents),
    totalTTC: fromCents(htCents + tvaCents),
  };
}

/** Aperçu tolérant pendant la saisie : une valeur vide ou invalide compte pour 0. */
export function previewTotals(lines: DocumentLineInput[] | undefined): DocumentTotals & { lineTotals: number[] } {
  const safe = (lines ?? []).map((l) => {
    const q = toNumber(l?.quantity);
    const p = toNumber(l?.unitPriceHT);
    const t = toNumber(l?.tvaRate);
    return {
      quantity: Number.isFinite(q) ? q : 0,
      unitPriceHT: Number.isFinite(p) ? p : 0,
      tvaRate: Number.isFinite(t) && t >= 0 && t <= 100 ? t : 0,
    };
  });
  return computeTotals(safe);
}

/** Validation stricte et calcul, côté serveur. */
export function computeDocumentLines(input: unknown): ComputeDocumentResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "Au moins une ligne requise" };
  const lines: Omit<ComputedDocumentLine, "totalHT">[] = [];
  for (let i = 0; i < input.length; i++) {
    const l = (input[i] ?? {}) as DocumentLineInput;
    const n = i + 1;
    const description = typeof l.description === "string" ? l.description.trim() : "";
    if (!description) return { ok: false, error: `Ligne ${n} : description requise` };
    const quantity = toNumber(l.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: `Ligne ${n} : quantité invalide` };
    const unitPriceHT = toNumber(l.unitPriceHT);
    if (!Number.isFinite(unitPriceHT) || unitPriceHT < 0) return { ok: false, error: `Ligne ${n} : prix unitaire invalide` };
    const tvaRate = l.tvaRate === undefined || l.tvaRate === null || l.tvaRate === "" ? DEFAULT_TVA_RATE : toNumber(l.tvaRate);
    if (!Number.isFinite(tvaRate) || tvaRate < 0 || tvaRate > 100) return { ok: false, error: `Ligne ${n} : taux de TVA invalide` };
    lines.push({ description, quantity, unitPriceHT, tvaRate });
  }
  const { lineTotals, ...totals } = computeTotals(lines);
  return { ok: true, lines: lines.map((l, i) => ({ ...l, totalHT: lineTotals[i] })), ...totals };
}
