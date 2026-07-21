export interface RelanceVars {
  clientName: string;
  companyName: string;
  number: string;
  amount: string;
  daysLate: number;
}

export const DEFAULT_MESSAGES: Record<1 | 2 | 3, string> = {
  1: "Bonjour {clientName},\n\nSauf erreur de notre part, la facture {number} d'un montant de {amount} € est arrivée à échéance depuis {daysLate} jour(s). Pourriez-vous procéder au règlement dès que possible ?\n\nCordialement,\n{companyName}",
  2: "Bonjour {clientName},\n\nNous revenons vers vous concernant la facture {number} ({amount} €), toujours impayée {daysLate} jours après son échéance. Merci de bien vouloir régulariser rapidement cette situation.\n\nCordialement,\n{companyName}",
  3: "Bonjour {clientName},\n\nMalgré nos précédentes relances, la facture {number} ({amount} €) reste impayée {daysLate} jours après échéance. Sans règlement sous 8 jours, nous serons contraints d'engager une action de recouvrement.\n\nCordialement,\n{companyName}",
};

export function renderMessage(template: string | null | undefined, niveau: 1 | 2 | 3, vars: RelanceVars): string {
  const base = template && template.trim() ? template : DEFAULT_MESSAGES[niveau];
  return base
    .replaceAll("{clientName}", vars.clientName)
    .replaceAll("{companyName}", vars.companyName)
    .replaceAll("{number}", vars.number)
    .replaceAll("{amount}", vars.amount)
    .replaceAll("{daysLate}", String(vars.daysLate));
}
