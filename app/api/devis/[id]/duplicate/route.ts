import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allocateDocumentNumber } from "@/lib/numbering/document-number";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    if (isSubscriptionBlocked(user)) {
      return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
    }

    const source = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
      include: { lines: true },
    });
    if (!source) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    // Même numérotation que la création web et WhatsApp
    // (lib/numbering/document-number.ts) : attribuée sous verrou, dans la
    // transaction qui crée la copie.
    const copy = await prisma.$transaction(async (tx) => {
      const { number, issuedAt } = await allocateDocumentNumber(tx, "devis", user.id);
      return tx.devis.create({
      data: {
        userId:       user.id,
        clientId:     source.clientId,
        number,
        createdAt:    issuedAt,
        status:       "brouillon",
        totalHT:      source.totalHT,
        totalTVA:     source.totalTVA,
        totalTTC:     source.totalTTC,
        validityDays: source.validityDays,
        notes:        source.notes,
        lines: {
          create: source.lines.map((l) => ({
            description: l.description,
            quantity:    l.quantity,
            unitPriceHT: l.unitPriceHT,
            tvaRate:     l.tvaRate,
            totalHT:     l.totalHT,
          })),
        },
      },
      include: { lines: true },
      });
    });

    return NextResponse.json(copy, { status: 201 });
  } catch (err) {
    console.error("[POST /api/devis/:id/duplicate]", err);
    return NextResponse.json({ error: "Erreur lors de la duplication" }, { status: 500 });
  }
}
