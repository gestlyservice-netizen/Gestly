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
