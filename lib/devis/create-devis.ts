import type { Prisma, PrismaClient, Devis, DevisLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { allocateDocumentNumber } from "@/lib/numbering/document-number";

// Logique métier extraite de app/api/devis/route.ts (POST) — même calcul
// des totaux, mêmes défauts. Partagée par l'API web et la création de devis
// depuis WhatsApp (lib/whatsapp/confirm-creation.ts). Numérotation
// centralisée dans lib/numbering/document-number.ts (tous les documents).
//
// Accepte un client de transaction Prisma optionnel (tx) pour permettre à
// l'appelant d'englober cette création dans une transaction plus large
// (ex. création du client + devis + mise à jour de la conversation en une
// seule opération atomique côté WhatsApp). Sans tx, ouvre sa propre
// transaction : la numérotation (lib/numbering/document-number.ts) en a besoin.
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

  // La numérotation exige une transaction (verrou consultatif, cf.
  // lib/numbering/document-number.ts). Appelé sans transaction (API web), on en
  // ouvre une ; appelé avec celle de l'appelant (WhatsApp), on la réutilise.
  if ("$transaction" in tx) {
    return tx.$transaction((t) => createDevisInTransaction(input, t));
  }
  return createDevisInTransaction(input, tx);
}

async function createDevisInTransaction(
  input: CreateDevisInput,
  tx: Prisma.TransactionClient
): Promise<DevisWithLines> {
  const client = await tx.client.findFirst({ where: { id: input.clientId, userId: input.userId } });
  if (!client) throw new CreateDevisError("Client introuvable", "CLIENT_NOT_FOUND");

  // Numéro attribué sous verrou par artisan, selon les Paramètres (préfixe,
  // prochain n°) ; date de création postérieure au verrou (chronologie).
  const { number, issuedAt } = await allocateDocumentNumber(tx, "devis", input.userId);

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
      createdAt: issuedAt,
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
