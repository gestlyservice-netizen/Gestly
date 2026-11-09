// Dates affichées sur les documents (PDF, emails) : toujours le jour
// calendaire de Paris, quel que soit le fuseau du serveur.
//
// Pourquoi : Vercel exécute le code en UTC. `toLocaleDateString("fr-FR")`
// sans fuseau et `setDate(getDate() + n)` y travaillent en UTC : un devis créé
// à 0 h 30 à Paris (22 h 30 ou 23 h 30 UTC la veille) était daté de la veille,
// et sa fin de validité pouvait reculer d'un jour en traversant le passage à
// l'heure d'hiver. Ici, on prend d'abord le jour de Paris, puis on compte en
// jours calendaires sur ce jour (sans heure), ce qui rend le calcul insensible
// au fuseau du serveur et aux changements d'heure.

export const TIME_ZONE_PARIS = "Europe/Paris";
const DAY_MS = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Jour calendaire (AAAA-MM-JJ) d'un instant, à l'heure de Paris. */
export function jourParis(d: Date | string): string {
  return new Date(d).toLocaleDateString("sv-SE", { timeZone: TIME_ZONE_PARIS });
}

/** Jour AAAA-MM-JJ + n jours calendaires (n peut être négatif). */
export function ajouterJours(jour: string, n: number): string {
  const m = DAY_RE.exec(jour);
  if (!m) throw new RangeError(`Jour invalide : ${jour}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + n * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** AAAA-MM-JJ → JJ/MM/AAAA. */
export function formatJourFr(jour: string): string {
  const m = DAY_RE.exec(jour);
  if (!m) throw new RangeError(`Jour invalide : ${jour}`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Date affichée sur un document : JJ/MM/AAAA du jour de Paris. */
export function formatDateParis(d: Date | string): string {
  return formatJourFr(jourParis(d));
}

/** Fin de validité d'un devis (AAAA-MM-JJ) : jour du devis à Paris + durée. */
export function finValiditeDevis(createdAt: Date | string, validityDays: number): string {
  return ajouterJours(jourParis(createdAt), validityDays);
}
