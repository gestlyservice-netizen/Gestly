import type { Prisma } from "@prisma/client";

// Numérotation des documents Gestly (devis, factures, avoirs) — SEUL endroit
// qui attribue un numéro, quel que soit le canal (interface web, duplication,
// transformation devis → facture, avoir, agent WhatsApp).
//
// Décisions métier validées (2026-10-22) :
//   D1 — Préfixe par défaut ("DEV-" / "FAC-") : série ANNUELLE
//        "DEV-2026-001", remise à 001 chaque année. « Prochain n° » désigne
//        le prochain numéro de la série de l'année en cours.
//   D2 — Préfixe personnalisé : numéro = préfixe + séquence (3 chiffres
//        minimum), série CONTINUE, jamais remise à zéro automatiquement.
//   D3 — Avoirs : série annuelle indépendante "AV-2026-001".
//   D4 — Un numéro déjà attribué n'est jamais réattribué, même si le
//        document (brouillon) est supprimé.
//
// ── Compteurs persistants (table DocumentNumberCounter) ────────────────────
// Un compteur par (artisan, type, série) mémorise le prochain numéro. C'est
// lui qui empêche de réattribuer le numéro d'un document supprimé (D4) et
// qui rend « Prochain n° » cohérent avec la remise à zéro annuelle (D1) :
// la série annuelle fait partie de la clé, une nouvelle année démarre donc
// un nouveau compteur.
// La table est créée par la migration
// prisma/manual-migrations/20261023_document_number_counters_up.sql. Tant
// qu'elle n'existe pas, la numérotation fonctionne sans compteur (plus grand
// numéro existant + 1) : les garanties qui en dépendent (D4 après
// suppression, choix de « Prochain n° » en série annuelle) sont alors
// indisponibles, et le choix de « Prochain n° » est refusé explicitement
// plutôt qu'ignoré (cf. validateRequestedNext).
//
// ── Séquence ───────────────────────────────────────────────────────────────
// séquence = max(plus grand numéro existant de la série + 1, compteur)
// Sans compteur encore créé pour une série personnalisée, la valeur
// « Prochain n° » enregistrée dans les Paramètres sert de compteur initial.
//
// ── Concurrence et chronologie ─────────────────────────────────────────────
// Verrou consultatif PostgreSQL par (artisan, type), pris dans la
// transaction de création : deux attributions simultanées sont
// sérialisées. La date d'émission (issuedAt) est fixée APRÈS l'obtention du
// verrou : l'ordre des numéros suit l'ordre des dates.
//
// Unicité au niveau PostgreSQL : seulement après application de
// 20261022_unique_document_numbers (index uniques).

export type DocumentKind = "devis" | "facture" | "avoir";
export type ConfigurableKind = Exclude<DocumentKind, "avoir">;

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
  // Compteur initial d'une série personnalisée sans compteur persistant.
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

// Vrai si la table des compteurs existe (migration appliquée). Vérifié à
// chaque fois (requête de catalogue triviale) : une transaction PostgreSQL
// en erreur ne peut pas se « rattraper », il ne faut donc jamais tenter un
// accès à une table absente.
export async function countersAvailable(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('public."DocumentNumberCounter"') IS NOT NULL AS ok`;
  return rows[0]?.ok === true;
}

async function highestSequence(tx: Prisma.TransactionClient, kind: DocumentKind, userId: string, prefix: string): Promise<number> {
  const args = { where: { userId, number: { startsWith: prefix } }, select: { number: true } } as const;
  const rows =
    kind === "devis" ? await tx.devis.findMany(args)
    : kind === "facture" ? await tx.facture.findMany(args)
    : await tx.avoir.findMany(args);
  return rows.reduce((max, { number }) => {
    const seq = sequenceInSeries(number, prefix);
    return seq !== null && seq > max ? seq : max;
  }, 0);
}

function counterKey(userId: string, kind: DocumentKind, series: string) {
  return { userId_kind_series: { userId, kind, series } };
}

export interface SeriesState {
  series: DocumentSeries;
  // Plus petit numéro attribuable sans jamais réutiliser un numéro existant
  // ou déjà attribué (compteur), c.-à-d. le « Prochain n° » réel.
  next: number;
  countersAvailable: boolean;
}

// État d'une série, SANS verrou (affichage, validation des Paramètres).
export async function readSeriesState(
  tx: Prisma.TransactionClient,
  kind: DocumentKind,
  userId: string,
  settings: NumberingSettings | null,
  now: Date = new Date()
): Promise<SeriesState> {
  const series = resolveSeries(kind, settings, now);
  const highest = await highestSequence(tx, kind, userId, series.prefix);
  const available = await countersAvailable(tx);
  const counter = available
    ? await tx.documentNumberCounter.findUnique({ where: counterKey(userId, kind, series.prefix) })
    : null;
  const next = Math.max(highest + 1, counter?.nextValue ?? series.floor);
  return { series, next, countersAvailable: available };
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
  const { series, next: sequence, countersAvailable: available } = await readSeriesState(tx, kind, userId, settings, now);

  if (available) {
    await tx.documentNumberCounter.upsert({
      where: counterKey(userId, kind, series.prefix),
      create: { userId, kind, series: series.prefix, nextValue: sequence + 1 },
      update: { nextValue: sequence + 1 },
    });
  }
  if (series.custom) {
    // Reflet dans les Paramètres (affichage, et compteur initial tant que la
    // table des compteurs n'existe pas).
    await tx.settings.update({
      where: { userId },
      data: kind === "devis" ? { prochainNumeroDevis: sequence + 1 } : { prochainNumeroFacture: sequence + 1 },
    });
  }

  return { number: formatDocumentNumber(series.prefix, sequence), issuedAt: new Date() };
}

// ── « Prochain n° » choisi dans les Paramètres ─────────────────────────────

export class NextNumberError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NextNumberError";
  }
}

const KIND_LABEL: Record<ConfigurableKind, string> = { devis: "devis", facture: "facture" };

// Applique un « Prochain n° » demandé pour la série résultant des Paramètres
// demandés. À appeler dans la transaction qui enregistre les Paramètres.
// Ne réécrit rien si la valeur demandée est celle déjà en vigueur ; lève
// NextNumberError (jamais d'ignorance silencieuse) si elle réutiliserait un
// numéro, ou si elle ne peut pas être enregistrée (série annuelle sans
// table des compteurs).
export async function applyRequestedNext(
  tx: Prisma.TransactionClient,
  kind: ConfigurableKind,
  userId: string,
  requestedSettings: NumberingSettings,
  requested: number,
  now: Date = new Date()
): Promise<void> {
  await lockDocumentNumbering(tx, kind, userId);
  const state = await readSeriesState(tx, kind, userId, requestedSettings, now);
  const label = KIND_LABEL[kind];

  if (!Number.isInteger(requested) || requested < 1) {
    throw new NextNumberError(`Le prochain numéro de ${label} doit être un entier supérieur ou égal à 1.`);
  }
  if (requested === state.next) return;
  if (requested < state.next) {
    throw new NextNumberError(
      `Le prochain numéro de ${label} ne peut pas être inférieur à ${state.next} : les numéros précédents de la série « ${state.series.prefix} » sont déjà attribués et ne sont jamais réutilisés.`
    );
  }
  if (!state.countersAvailable) {
    if (state.series.custom) return; // compteur initial = Settings, enregistré par l'appelant
    throw new NextNumberError(
      `Avec le préfixe par défaut, le prochain numéro de ${label} suit la série annuelle « ${state.series.prefix} » (prochain : ${state.next}). Le choix d'un autre numéro de départ sera disponible après la mise à jour de la base (compteurs de numérotation).`
    );
  }
  await tx.documentNumberCounter.upsert({
    where: counterKey(userId, kind, state.series.prefix),
    create: { userId, kind, series: state.series.prefix, nextValue: requested },
    update: { nextValue: requested },
  });
}
