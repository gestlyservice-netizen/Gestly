import type { Prisma } from "@prisma/client";

// Numérotation des documents Gestly (devis, factures, avoirs) — SEUL endroit
// qui attribue un numéro, quel que soit le canal (interface web, duplication,
// transformation devis → facture, avoir, agent WhatsApp).
//
// ── Série ──────────────────────────────────────────────────────────────────
// - Préfixe des Paramètres laissé à sa valeur par défaut ("DEV-" / "FAC-"),
//   ou aucun paramètre enregistré : format historique INCHANGÉ, série
//   annuelle "DEV-2026-001", "FAC-2026-001" (remise à 001 chaque année).
// - Préfixe personnalisé : numéro = préfixe + séquence sur 3 chiffres
//   minimum, exactement comme l'aperçu de la page Paramètres
//   (« {préfixe}001 ») ; série continue (l'utilisateur inclut lui-même
//   l'année dans son préfixe s'il le souhaite, cf. l'exemple "DEV-2026-").
// - Avoirs : pas de paramètre dédié → série annuelle "AV-2026-001".
//
// ── Séquence ───────────────────────────────────────────────────────────────
// séquence = max(plus grand numéro existant de la série + 1, « Prochain n° »)
//   - « Prochain n° » n'est pris en compte qu'avec un préfixe personnalisé
//     (sinon il ne pourrait pas suivre la remise à zéro annuelle de la série
//     historique) ; il sert de numéro de départ (reprise d'un autre
//     logiciel) et n'est jamais une raison de réutiliser un numéro : s'il est
//     inférieur au dernier numéro existant, il est ignoré.
//   - Après chaque attribution en série personnalisée, « Prochain n° » est
//     avancé : il reste exact dans les Paramètres, et un numéro n'est jamais
//     réattribué même si le dernier document est supprimé.
//
// ── Concurrence et chronologie ─────────────────────────────────────────────
// Un verrou consultatif PostgreSQL par (artisan, type de document), pris dans
// la transaction de création, sérialise les attributions : deux créations
// simultanées ne lisent jamais le même « dernier numéro ». Libéré à la fin de
// la transaction. La date d'émission (issuedAt) est fixée APRÈS l'obtention
// du verrou : l'ordre des numéros suit l'ordre des dates.
//
// La garantie d'unicité au niveau PostgreSQL (index uniques) n'existe pas
// tant que les migrations proposées dans prisma/manual-migrations/ ne sont
// pas appliquées : cette numérotation repose sur le fait que TOUT le code
// passe par ce module.

export type DocumentKind = "devis" | "facture" | "avoir";

const LEGACY_PREFIX: Record<DocumentKind, string> = { devis: "DEV-", facture: "FAC-", avoir: "AV-" };

// Valeurs par défaut des colonnes Settings.prefixeDevis / prefixeFacture.
export const DEFAULT_SETTINGS_PREFIX = { devis: "DEV-", facture: "FAC-" } as const;

export interface NumberingSettings {
  prefixeDevis: string;
  prefixeFacture: string;
  prochainNumeroDevis: number;
  prochainNumeroFacture: number;
}

export interface DocumentSeries {
  prefix: string;
  custom: boolean;
  floor: number;
}

export function resolveSeries(kind: DocumentKind, settings: NumberingSettings | null, now: Date = new Date()): DocumentSeries {
  const legacy = { prefix: `${LEGACY_PREFIX[kind]}${now.getFullYear()}-`, custom: false, floor: 1 };
  if (kind === "avoir" || !settings) return legacy;

  const prefix = (kind === "devis" ? settings.prefixeDevis : settings.prefixeFacture)?.trim();
  if (!prefix || prefix === DEFAULT_SETTINGS_PREFIX[kind]) return legacy;

  const next = kind === "devis" ? settings.prochainNumeroDevis : settings.prochainNumeroFacture;
  return { prefix, custom: true, floor: Number.isInteger(next) && next > 1 ? next : 1 };
}

// Séquence numérique d'un numéro dans une série, ou null si le numéro
// n'appartient pas à la série (ex. "DEV-2026-001" pour un préfixe "DEV").
export function sequenceInSeries(number: string, prefix: string): number | null {
  if (!number.startsWith(prefix)) return null;
  const suffix = number.slice(prefix.length);
  return /^\d+$/.test(suffix) ? Number.parseInt(suffix, 10) : null;
}

export function formatDocumentNumber(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(3, "0")}`;
}

// Doit être appelé À L'INTÉRIEUR d'une transaction interactive.
export async function lockDocumentNumbering(tx: Prisma.TransactionClient, kind: DocumentKind, userId: string): Promise<void> {
  const key = `gestly:${kind}-number:${userId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
}

async function existingNumbers(tx: Prisma.TransactionClient, kind: DocumentKind, userId: string, prefix: string): Promise<string[]> {
  const args = { where: { userId, number: { startsWith: prefix } }, select: { number: true } } as const;
  const rows =
    kind === "devis" ? await tx.devis.findMany(args)
    : kind === "facture" ? await tx.facture.findMany(args)
    : await tx.avoir.findMany(args);
  return rows.map((r) => r.number);
}

export interface AllocatedNumber {
  number: string;
  // Date d'émission à enregistrer (createdAt) : postérieure à l'obtention du
  // verrou, donc cohérente avec l'ordre des numéros.
  issuedAt: Date;
}

export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  kind: DocumentKind,
  userId: string,
  now: Date = new Date()
): Promise<AllocatedNumber> {
  await lockDocumentNumbering(tx, kind, userId);

  const settings = kind === "avoir" ? null : await tx.settings.findUnique({ where: { userId } });
  const series = resolveSeries(kind, settings, now);

  const highest = (await existingNumbers(tx, kind, userId, series.prefix)).reduce((max, n) => {
    const seq = sequenceInSeries(n, series.prefix);
    return seq !== null && seq > max ? seq : max;
  }, 0);
  const sequence = Math.max(highest + 1, series.floor);

  if (series.custom) {
    await tx.settings.update({
      where: { userId },
      data: kind === "devis" ? { prochainNumeroDevis: sequence + 1 } : { prochainNumeroFacture: sequence + 1 },
    });
  }

  return { number: formatDocumentNumber(series.prefix, sequence), issuedAt: new Date() };
}
