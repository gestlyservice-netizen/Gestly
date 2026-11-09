import { CONDITIONS_DEFAUT, conditionsPaiement, echeanceUlterieure } from "@/lib/documents/legal-mentions";

// Aperçu, sous le champ « Date d'échéance », de la mention de paiement qui
// sera imprimée sur la facture : même règle que le PDF et l'email
// (lib/documents/legal-mentions.ts). Émission = aujourd'hui.
export function MentionEcheance({ dueDate }: { dueDate: string | null | undefined }) {
  if (!dueDate) return null;
  const doc = { issuedAt: new Date(), dueDate };
  if (echeanceUlterieure(doc)) {
    return (
      <p className="text-xs text-slate-500" data-testid="mention-echeance">
        Mention imprimée sur la facture : « {conditionsPaiement(null, doc)} » (jamais « à réception »)
      </p>
    );
  }
  return (
    <p className="text-xs text-slate-500" data-testid="mention-echeance">
      Échéance le jour de l&apos;émission : vos conditions de paiement s&apos;appliquent (par défaut « {CONDITIONS_DEFAUT} »)
    </p>
  );
}
