import { factureBalance, type FactureForBalance } from "@/lib/factures/balance";

// Échéance et retard des factures — règle unique partagée par la création
// (formulaire, transformation d'un devis), les écrans (liste, fiche, tableau
// de bord) et le moteur de relances. Avant : trois définitions différentes du
// « retard » (échéance dépassée d'une seconde, 30 jours après l'émission
// pour une facture sans échéance, « J+N » depuis l'émission au tableau de
// bord), et des factures sans échéance affichées « En retard » sans jamais
// être relancées.
//
// Règles (décision utilisateur, 2026-11-03) :
// - toute nouvelle facture a une échéance, proposée à émission + 30 jours et
//   modifiable, jamais antérieure à la date d'émission ;
// - une facture est en retard à partir du lendemain de son échéance, tant
//   qu'il reste un montant à encaisser (lib/factures/balance.ts) ;
// - une ancienne facture sans échéance n'est jamais « en retard » ni relancée.

export const DELAI_PAIEMENT_DEFAUT_JOURS = 30;
const DAY = 86_400_000;
const TIME_ZONE = "Europe/Paris";

/** Jour calendaire (AAAA-MM-JJ) d'un instant, à l'heure de Paris. */
export function jourParis(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TIME_ZONE });
}

/** Échéance proposée (AAAA-MM-JJ) : date d'émission + 30 jours. */
export function defaultDueDateIso(issuedAt: Date = new Date()): string {
  return jourParis(new Date(issuedAt.getTime() + DELAI_PAIEMENT_DEFAUT_JOURS * DAY));
}

export type DueDateResult = { ok: true; date: Date } | { ok: false; error: string };

/**
 * Échéance d'une NOUVELLE facture : obligatoire, au format AAAA-MM-JJ (champ
 * date du formulaire), pas avant la date d'émission. Enregistrée à minuit UTC
 * du jour choisi, comme auparavant.
 */
export function parseDueDate(value: unknown, issuedAt: Date = new Date()): DueDateResult {
  if (value === undefined || value === null || value === "") {
    return { ok: false, error: "Date d'échéance obligatoire" };
  }
  const day = typeof value === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(value)?.[1] : undefined;
  const date = day ? new Date(`${day}T00:00:00.000Z`) : null;
  if (!day || !date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    return { ok: false, error: "Date d'échéance invalide" };
  }
  if (day < jourParis(issuedAt)) {
    return { ok: false, error: "La date d'échéance ne peut pas précéder la date d'émission" };
  }
  return { ok: true, date };
}

/** Jours entiers écoulés depuis l'échéance (0 le jour même) ; null sans échéance. */
export function joursDeRetard(dueDate: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!dueDate) return null;
  return Math.floor((now.getTime() - new Date(dueDate).getTime()) / DAY);
}

export interface FactureForStatut extends FactureForBalance {
  dueDate: Date | string | null;
}

export type StatutFacture = "payee" | "soldee" | "en_retard" | "emise";

/** Statut affiché d'une facture : identique dans la liste, la fiche et le tableau de bord. */
export function statutFacture(f: FactureForStatut, now: Date = new Date()): { statut: StatutFacture; joursRetard: number | null } {
  if (f.status === "payee") return { statut: "payee", joursRetard: null };
  if (factureBalance(f).fullyCredited) return { statut: "soldee", joursRetard: null };
  const jours = joursDeRetard(f.dueDate, now);
  if (jours !== null && jours >= 1) return { statut: "en_retard", joursRetard: jours };
  return { statut: "emise", joursRetard: null };
}

export const STATUT_FACTURE_LABEL: Record<StatutFacture, string> = {
  payee: "Payée",
  soldee: "Soldée par avoir",
  en_retard: "En retard",
  emise: "Émise",
};
