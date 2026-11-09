// Validation d'UNE adresse email de destinataire avant tout envoi.
//
// Volontairement stricte (forme courante local@domaine.tld) : on préfère
// refuser une adresse exotique mais valide plutôt que transmettre à Resend
// une liste d'adresses (« a@x.fr, b@y.fr »), un nom affiché (« Nom <a@x.fr> »)
// ou une valeur contenant un retour à la ligne (tentative d'injection
// d'en-têtes, ex. « a@x.fr\r\nBcc: … »).

// 254 caractères : longueur maximale d'une adresse utilisable (RFC 5321).
const MAX_LENGTH = 254;
// Partie locale : caractères usuels, sans espace, virgule, point-virgule,
// chevrons ni guillemets. Domaine : labels alphanumériques (tirets internes),
// au moins un point, extension alphabétique d'au moins 2 lettres.
const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** Adresse nettoyée (espaces de bord retirés) si elle est valide, sinon null. */
export function parseEmailAddress(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > MAX_LENGTH) return null;
  if (!EMAIL_RE.test(value)) return null;
  const [local] = value.split("@");
  // Points en tête, en fin ou doublés dans la partie locale : refusés par
  // la plupart des serveurs, donc refusés ici plutôt que par Resend.
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return value;
}
