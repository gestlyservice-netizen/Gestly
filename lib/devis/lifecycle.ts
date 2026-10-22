import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Règles de cycle de vie des devis (décisions D4 et D6, validées le 2026-10-22).
//
// D4 — Seul un devis BROUILLON qui n'a jamais quitté ce statut peut être
//      supprimé : un devis envoyé, signé ou facturé est conservé, même s'il a
//      été « repassé en brouillon » depuis l'interface pour être retouché
//      (l'historique sentAt / signedAt fait foi, pas le statut du moment).
// D6 — Une facture émise ne se modifie pas. Un devis facturé ne peut donc
//      plus être modifié ni changer de statut (sauf « payé »), pour que la
//      facture qui en est issue ne puisse ni changer de contenu ni être
//      émise une seconde fois.

type Db = Prisma.TransactionClient | PrismaClient;

export interface DevisHistory {
  status: string;
  sentAt: Date | null;
  signedAt: Date | null;
}

export async function isDevisInvoiced(devisId: string, db: Db = prisma): Promise<boolean> {
  return (await db.facture.count({ where: { devisId } })) > 0;
}

export function hasLeftDraft(devis: DevisHistory): boolean {
  return devis.status !== "brouillon" || devis.sentAt !== null || devis.signedAt !== null;
}

export function deletionRefusal(devis: DevisHistory, invoiced: boolean): string | null {
  if (invoiced) return "Ce devis a été facturé : il ne peut pas être supprimé.";
  if (hasLeftDraft(devis)) {
    return "Seuls les devis brouillons jamais envoyés ni signés peuvent être supprimés. Ce devis est conservé (son numéro n'est jamais réattribué).";
  }
  return null;
}

export function modificationRefusal(invoiced: boolean): string | null {
  return invoiced ? "Ce devis a été facturé : il ne peut plus être modifié (la facture émise ne change pas)." : null;
}

export function statusChangeRefusal(from: string, to: string, invoiced: boolean): string | null {
  if (from === to) return null;
  if (invoiced && !(from === "facture" && to === "paye")) {
    return "Ce devis a été facturé : son statut ne peut plus changer, sauf pour le marquer comme payé.";
  }
  return null;
}
