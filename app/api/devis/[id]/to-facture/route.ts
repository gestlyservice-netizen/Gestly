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

    const devis = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    if (devis.status !== "signe") {
      return NextResponse.json(
        { error: "Seul un devis signé peut être transformé en facture" },
        { status: 400 }
      );
    }

    // Générer numéro de facture FAC-ANNÉE-XXX
    const year = new Date().getFullYear();
    const count = await prisma.facture.count({
      where: { userId: user.id, number: { startsWith: `FAC-${year}-` } },
    });
    const number = `FAC-${year}-${String(count + 1).padStart(3, "0")}`;

    // Créer la facture et mettre à jour le devis dans une transaction
    const [facture] = await prisma.$transaction([
      prisma.facture.create({
        data: {
          userId:   user.id,
          clientId: devis.clientId,
          devisId:  devis.id,
          number,
          status:   "emise",
          totalHT:  devis.totalHT,
          totalTVA: devis.totalTVA,
          totalTTC: devis.totalTTC,
        },
      }),
      prisma.devis.update({
        where: { id: devis.id },
        data: { status: "facture" },
      }),
    ]);

    return NextResponse.json(facture, { status: 201 });
  } catch (err) {
    console.error("[POST /api/devis/:id/to-facture]", err);
    return NextResponse.json({ error: "Erreur lors de la transformation" }, { status: 500 });
  }
}
