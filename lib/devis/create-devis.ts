import type { Prisma, PrismaClient, Devis, DevisLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Logique métier extraite de app/api/devis/route.ts (POST) à l'identique —
// même algorithme de numérotation, même calcul des totaux, même défauts.
// Comportement inchangé pour l'API web ; réutilisé tel quel par la création
// de devis depuis WhatsApp (lib/whatsapp/confirm-creation.ts).
//
// Accepte un client de transaction Prisma optionnel (tx) pour permettre à
// l'appelant d'englober cette création dans une transaction plus large
// (ex. création du client + devis + mise à jour de la conversation en une
// seule opération atomique côté WhatsApp). Sans tx, se comporte exactement
// comme avant (écriture Devis+lignes déjà atomique via l'écriture imbriquée
// Prisma standard).
export interface CreateDevisLineInput {
  description: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
}

export interface CreateDevisInput {
  userId: string;
  clientId: string;
  validityDays?: number;
  notes?: string | null;
  status?: string;
  lines: CreateDevisLineInput[];
}

export type DevisWithLines = Devis & { lines: DevisLine[] };

export class CreateDevisError extends Error {
  constructor(message: string, readonly code: "NO_CLIENT" | "NO_LINES" | "CLIENT_NOT_FOUND") {
    super(message);
    this.name = "CreateDevisError";
  }
}

export async function createDevis(
  input: CreateDevisInput,
  tx: Prisma.TransactionClient | PrismaClient = prisma
): Promise<DevisWithLines> {
  if (!input.clientId) throw new CreateDevisError("Client requis", "NO_CLIENT");
  if (!input.lines?.length) throw new CreateDevisError("Au moins une ligne requise", "NO_LINES");

  const client = await tx.client.findFirst({ where: { id: input.clientId, userId: input.userId } });
  if (!client) throw new CreateDevisError("Client introuvable", "CLIENT_NOT_FOUND");

  // Numéro de devis : DEV-2026-001. Calculé à l'intérieur de la transaction
  // fournie par l'appelant quand il y en a une, pour rester cohérent avec le
  // reste de l'opération atomique côté WhatsApp.
  const year = new Date().getFullYear();
  const count = await tx.devis.count({
    where: { userId: input.userId, number: { startsWith: `DEV-${year}-` } },
  });
  const number = `DEV-${year}-${String(count + 1).padStart(3, "0")}`;

  const computedLines = input.lines.map((l) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPriceHT: Number(l.unitPriceHT),
    tvaRate: Number(l.tvaRate),
    totalHT: Number(l.quantity) * Number(l.unitPriceHT),
  }));

  const totalHT = computedLines.reduce((acc, l) => acc + l.totalHT, 0);
  const totalTVA = computedLines.reduce((acc, l) => acc + (l.totalHT * l.tvaRate) / 100, 0);
  const totalTTC = totalHT + totalTVA;

  const status = input.status ?? "brouillon";

  return tx.devis.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      number,
      status,
      totalHT,
      totalTVA,
      totalTTC,
      validityDays: input.validityDays ?? 30,
      notes: input.notes?.trim() || null,
      sentAt: status === "envoye" ? new Date() : null,
      lines: { create: computedLines },
    },
    include: { lines: true },
  });
}
