// Adresse email d'un client : règle unique pour la création et la
// modification (formulaires et API). Module pur, importable côté client.
//
//   - champ vide → aucune adresse (null) ;
//   - nouvelle adresse → une seule adresse valide (parseEmailAddress, même
//     règle que l'envoi des devis, factures et relances) ;
//   - adresse INCHANGÉE d'un client existant → conservée telle quelle, même
//     si elle ne respecte pas la règle (fiches antérieures à la validation :
//     on ne bloque pas la modification du nom ou du téléphone). Elle reste
//     refusée à l'envoi, avec un message invitant à la corriger.
import { parseEmailAddress } from "@/lib/email/address";

export const CLIENT_EMAIL_ERROR = "Adresse email invalide : une seule adresse, ex. nom@exemple.fr";

export type ClientEmailResult = { ok: true; email: string | null } | { ok: false; error: string };

export function normalizeClientEmail(input: unknown, current?: string | null): ClientEmailResult {
  if (input === undefined || input === null) return { ok: true, email: null };
  if (typeof input !== "string") return { ok: false, error: CLIENT_EMAIL_ERROR };
  const value = input.trim();
  if (!value) return { ok: true, email: null };
  if (current != null && value === current.trim()) return { ok: true, email: current };
  const email = parseEmailAddress(value);
  return email ? { ok: true, email } : { ok: false, error: CLIENT_EMAIL_ERROR };
}

/** Vrai si une adresse enregistrée ne permettrait pas d'envoyer un email. */
export function isStoredEmailInvalid(email: string | null | undefined): boolean {
  return !!email?.trim() && parseEmailAddress(email) === null;
}
