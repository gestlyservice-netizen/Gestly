// Solde d'une facture après avoirs — calcul unique utilisé par l'écran
// Factures, le tableau de bord, la fiche facture, le marquage « payée » et les
// relances. Une facture émise n'est jamais modifiée : ce sont ses avoirs qui
// réduisent ce que le client doit encore.
//
// Règles :
// - montant net = TTC facturé − Σ TTC des avoirs (jamais négatif) ;
// - reste à encaisser = montant net, ou 0 si la facture est payée (un avoir
//   émis après paiement est un remboursement dû au client, pas un impayé) ;
// - facture « soldée par avoir » = montant net nul : rien à encaisser, à
//   relancer ni à marquer payée ;
// - calcul en centimes entiers (aucune dérive de virgule flottante).

export interface FactureForBalance {
  totalTTC: number;
  status: string;
  avoirs?: { totalTTC: number }[] | null;
}

export interface FactureBalance {
  credited: number;      // Σ TTC des avoirs
  net: number;           // TTC facturé − avoirs
  outstanding: number;   // reste à encaisser
  fullyCredited: boolean;
}

const toCents = (euros: number) => Math.round(Number((euros * 100).toFixed(6)));

export function factureBalance(f: FactureForBalance): FactureBalance {
  const totalCents = toCents(f.totalTTC);
  const creditedCents = (f.avoirs ?? []).reduce((s, a) => s + toCents(a.totalTTC), 0);
  const netCents = Math.max(0, totalCents - creditedCents);
  return {
    credited: creditedCents / 100,
    net: netCents / 100,
    outstanding: f.status === "payee" ? 0 : netCents / 100,
    fullyCredited: netCents === 0,
  };
}

/** Factures qui restent à encaisser et leur total (impayés). */
export function summarizeOutstanding<T extends FactureForBalance>(factures: T[]) {
  const pending = factures
    .map((f) => ({ facture: f, outstanding: factureBalance(f).outstanding }))
    .filter((x) => x.outstanding > 0);
  const totalCents = pending.reduce((s, x) => s + toCents(x.outstanding), 0);
  return { pending, total: totalCents / 100, count: pending.length };
}
