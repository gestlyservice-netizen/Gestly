import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const facture = await prisma.facture.findFirst({ where: { id: params.id, userId: user.id } });
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const relances = await prisma.relance.findMany({
    where: { factureId: params.id },
    orderBy: [{ niveau: "asc" }, { canal: "asc" }],
  });
  return NextResponse.json(relances);
}
