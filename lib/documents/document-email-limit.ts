// Limitation de débit des envois de devis et factures par email.
// Partagée entre instances (lib/rate-limit-db.ts, table "RateLimitBucket")
// une fois la migration 20261109 appliquée ; en mémoire auparavant.
// Protège contre les doubles clics, les boucles côté navigateur et l'envoi
// en rafale au même client.
import { consumeRateLimit } from "@/lib/rate-limit-db";

export const DOCUMENT_EMAIL_LIMITS = {
  // Même document : 3 envois par tranche de 10 minutes.
  perDocument: { limit: 3, windowMs: 10 * 60 * 1000 },
  // Tous documents d'un compte : 50 envois par heure (facturation de fin de mois).
  perAccount: { limit: 50, windowMs: 60 * 60 * 1000 },
} as const;

export const DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE =
  "Trop d'envois en peu de temps. Patientez quelques minutes avant de renvoyer ce document.";

export async function isDocumentEmailRateLimited(
  userId: string,
  kind: "devis" | "facture",
  documentId: string
): Promise<boolean> {
  const { perDocument, perAccount } = DOCUMENT_EMAIL_LIMITS;
  // Un document bloqué ne consomme pas le quota du compte.
  if ((await consumeRateLimit(`document-email:${kind}:${documentId}`, perDocument.limit, perDocument.windowMs)).limited) {
    return true;
  }
  return (await consumeRateLimit(`document-email:account:${userId}`, perAccount.limit, perAccount.windowMs)).limited;
}
