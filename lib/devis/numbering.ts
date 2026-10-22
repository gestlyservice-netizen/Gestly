import type { Prisma } from "@prisma/client";

// Numérotation des devis — seul endroit qui attribue un numéro, quel que
// soit le canal de création (interface web, duplication, agent WhatsApp).
// Format inchangé : DEV-<année>-<séquence sur 3 chiffres minimum>.
//
// Deux causes de doublon corrigées (l'ancienne règle était "nombre de devis
// de l'année + 1") :
//   1. Suppression d'un devis : le nombre baisse et le numéro suivant
//      rejoue un numéro existant (001, 002, 003 → suppression de 002 →
//      nouveau 003). On part désormais du PLUS GRAND numéro existant.
//   2. Créations simultanées (deux onglets, web + WhatsApp, deux workers) :
//      un verrou consultatif PostgreSQL par artisan, pris dans la
//      transaction de création, sérialise l'attribution — le second
//      attend la validation du premier puis voit son numéro. Libéré
//      automatiquement à la fin de la transaction (fonctionne aussi
//      derrière un pooler en mode transaction). Aucune migration requise.
//
// Garantie définitive possible (non appliquée, nécessite une migration et
// l'accord de l'utilisateur) : index unique (userId, number) sur "Devis".

// Doit être appelé À L'INTÉRIEUR d'une transaction interactive : le verrou
// n'a d'effet que jusqu'à la fin de la transaction qui l'a pris.
export async function lockDevisNumbering(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const key = `gestly:devis-number:${userId}`;
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${key}))`;
}

export function devisNumberPrefix(now: Date = new Date()): string {
  return `DEV-${now.getFullYear()}-`;
}

export async function nextDevisNumber(
  tx: Prisma.TransactionClient,
  userId: string,
  now: Date = new Date()
): Promise<string> {
  await lockDevisNumbering(tx, userId);
  const prefix = devisNumberPrefix(now);
  const existing = await tx.devis.findMany({
    where: { userId, number: { startsWith: prefix } },
    select: { number: true },
  });
  const highest = existing.reduce((max, { number }) => {
    const seq = Number.parseInt(number.slice(prefix.length), 10);
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}
