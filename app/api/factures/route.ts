import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const factures = await prisma.facture.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: { client: { select: { name: true } } },
    });

    return NextResponse.json(factures);
  } catch (err) {
    console.error("[GET /api/factures]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const body: unknown = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
    }

    const { clientId, notes, dueDate, lines } = body as Record<string, unknown>;

    if (typeof clientId !== "string" || !clientId) {
      return NextResponse.json({ error: "Client requis" }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: "Au moins une prestation requise" }, { status: 400 });
    }

    // Vérifier que le client appartient à l'utilisateur
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
    if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

    // Générer le numéro : FAC-ANNÉE-XXX
    const year = new Date().getFullYear();
    const count = await prisma.facture.count({
      where: { userId: user.id, number: { startsWith: `FAC-${year}-` } },
    });
    const number = `FAC-${year}-${String(count + 1).padStart(3, "0")}`;

    // Calculer les lignes et totaux
    const computedLines = (lines as Record<string, unknown>[]).map((l) => {
      const qty   = Number(l.quantity)    || 0;
      const price = Number(l.unitPriceHT) || 0;
      const tva   = Number(l.tvaRate)     ?? 20;
      return {
        description: String(l.description ?? ""),
        quantity:    qty,
        unitPriceHT: price,
        tvaRate:     tva,
        totalHT:     qty * price,
      };
    });

    const totalHT  = computedLines.reduce((s, l) => s + l.totalHT, 0);
    const totalTVA = computedLines.reduce((s, l) => s + l.totalHT * l.tvaRate / 100, 0);
    const totalTTC = totalHT + totalTVA;

    const facture = await prisma.facture.create({
      data: {
        userId:   user.id,
        clientId,
        number,
        status:   "emise",
        totalHT,
        totalTVA,
        totalTTC,
        notes:    typeof notes === "string" && notes.trim() ? notes.trim() : null,
        dueDate:  typeof dueDate === "string" && dueDate ? new Date(dueDate) : null,
        lines:    { create: computedLines },
      },
      include: { client: true, lines: true },
    });

    return NextResponse.json(facture, { status: 201 });
  } catch (err) {
    console.error("[POST /api/factures]", err);
    return NextResponse.json({ error: "Erreur lors de la création" }, { status: 500 });
  }
}
