import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const source = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
      include: { lines: true },
    });
    if (!source) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    const year = new Date().getFullYear();
    const count = await prisma.devis.count({
      where: { userId: user.id, number: { startsWith: `DEV-${year}-` } },
    });
    const number = `DEV-${year}-${String(count + 1).padStart(3, "0")}`;

    const copy = await prisma.devis.create({
      data: {
        userId:       user.id,
        clientId:     source.clientId,
        number,
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

    return NextResponse.json(copy, { status: 201 });
  } catch (err) {
    console.error("[POST /api/devis/:id/duplicate]", err);
    return NextResponse.json({ error: "Erreur lors de la duplication" }, { status: 500 });
  }
}
