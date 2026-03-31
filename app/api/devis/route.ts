import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await prisma.devis.findMany({
    where: { userId: user.id },
    include: { client: { select: { name: true } }, lines: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(devis);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const body = await request.json();
  const { clientId, validityDays, notes, lines, status } = body;

  if (!clientId) return NextResponse.json({ error: "Client requis" }, { status: 400 });
  if (!lines?.length) return NextResponse.json({ error: "Au moins une ligne requise" }, { status: 400 });

  // Vérifier que le client appartient à l'utilisateur
  const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
  if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });

  // Générer le numéro de devis : DEV-2026-001
  const year = new Date().getFullYear();
  const count = await prisma.devis.count({
    where: { userId: user.id, number: { startsWith: `DEV-${year}-` } },
  });
  const number = `DEV-${year}-${String(count + 1).padStart(3, "0")}`;

  // Calculer les totaux
  const computedLines = lines.map((l: { description: string; quantity: number; unitPriceHT: number; tvaRate: number }) => ({
    description: l.description,
    quantity: Number(l.quantity),
    unitPriceHT: Number(l.unitPriceHT),
    tvaRate: Number(l.tvaRate),
    totalHT: Number(l.quantity) * Number(l.unitPriceHT),
  }));

  const totalHT = computedLines.reduce((acc: number, l: { totalHT: number }) => acc + l.totalHT, 0);
  const totalTVA = computedLines.reduce((acc: number, l: { totalHT: number; tvaRate: number }) => acc + l.totalHT * l.tvaRate / 100, 0);
  const totalTTC = totalHT + totalTVA;

  const devis = await prisma.devis.create({
    data: {
      userId: user.id,
      clientId,
      number,
      status: status ?? "brouillon",
      totalHT,
      totalTVA,
      totalTTC,
      validityDays: Number(validityDays) || 30,
      notes: notes?.trim() || null,
      sentAt: status === "envoye" ? new Date() : null,
      lines: { create: computedLines },
    },
    include: { lines: true },
  });

  return NextResponse.json(devis, { status: 201 });
}
