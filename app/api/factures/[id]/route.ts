import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const facture = await prisma.facture.findFirst({
      where: { id: params.id, userId: user.id },
      include: {
        client: true,
        devis:  { include: { lines: true } },
      },
    });

    if (!facture) {
      return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
    }

    // Charger les lignes propres (FactureLine) séparément pour éviter
    // tout problème de client Prisma non régénéré entre deux déploiements
    let ownLines: Array<{
      id: string;
      factureId: string;
      description: string;
      quantity: number;
      unitPriceHT: number;
      tvaRate: number;
      totalHT: number;
    }> = [];
    try {
      ownLines = await prisma.factureLine.findMany({
        where: { factureId: params.id },
      });
    } catch {
      // FactureLine pas encore disponible dans le client Prisma déployé,
      // on utilise les lignes du devis lié à la place
      ownLines = [];
    }

    return NextResponse.json({ ...facture, lines: ownLines });
  } catch (err) {
    console.error("[GET /api/factures/:id]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    }

    const facture = await prisma.facture.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!facture) {
      return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });
    }

    const body = await request.json() as { action?: string };

    if (body.action === "mark_paid") {
      const updated = await prisma.facture.update({
        where: { id: params.id },
        data:  { status: "payee", paidAt: new Date() },
        include: { client: true, devis: { include: { lines: true } } },
      });

      let ownLines: Array<{
        id: string;
        factureId: string;
        description: string;
        quantity: number;
        unitPriceHT: number;
        tvaRate: number;
        totalHT: number;
      }> = [];
      try {
        ownLines = await prisma.factureLine.findMany({ where: { factureId: params.id } });
      } catch {
        ownLines = [];
      }

      return NextResponse.json({ ...updated, lines: ownLines });
    }

    return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  } catch (err) {
    console.error("[PATCH /api/factures/:id]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
