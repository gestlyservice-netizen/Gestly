import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allocateDocumentNumber } from "@/lib/numbering/document-number";
import { computeDocumentLines } from "@/lib/documents/totals";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    if (isSubscriptionBlocked(user)) {
      return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
    }

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
    if (isSubscriptionBlocked(user)) {
      return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
    }

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

    // Lignes validées et totaux arrondis au centime (lib/documents/totals.ts)
    const computed = computeDocumentLines(lines);
    if (!computed.ok) return NextResponse.json({ error: computed.error }, { status: 400 });
    const { lines: computedLines, totalHT, totalTVA, totalTTC } = computed;
    const due = typeof dueDate === "string" && dueDate ? new Date(dueDate) : null;
    if (due && Number.isNaN(due.getTime())) {
      return NextResponse.json({ error: "Date d'échéance invalide" }, { status: 400 });
    }

    // Numéro attribué sous verrou dans la transaction de création
    // (lib/numbering/document-number.ts) : unique, jamais réutilisé, et
    // date d'émission cohérente avec l'ordre des numéros.
    const facture = await prisma.$transaction(async (tx) => {
      const { number, issuedAt } = await allocateDocumentNumber(tx, "facture", user.id);
      return tx.facture.create({
      data: {
        userId:   user.id,
        clientId,
        number,
        createdAt: issuedAt,
        status:   "emise",
        totalHT,
        totalTVA,
        totalTTC,
        notes:    typeof notes === "string" && notes.trim() ? notes.trim() : null,
        dueDate:  due,
        lines:    { create: computedLines },
      },
      include: { client: true, lines: true },
      });
    });

    return NextResponse.json(facture, { status: 201 });
  } catch (err) {
    console.error("[POST /api/factures]", err);
    return NextResponse.json({ error: "Erreur lors de la création" }, { status: 500 });
  }
}
