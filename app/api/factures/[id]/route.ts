import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getFactureForUser(id: string, userId: string) {
  return prisma.facture.findFirst({
    where: { id, userId },
    include: {
      client: true,
      lines:  true,
      devis:  { include: { lines: true } },
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const facture = await getFactureForUser(params.id, user.id);
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  return NextResponse.json(facture);
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const facture = await getFactureForUser(params.id, user.id);
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const body = await request.json();

  if (body.action === "mark_paid") {
    const updated = await prisma.facture.update({
      where: { id: params.id },
      data:  { status: "payee", paidAt: new Date() },
      include: { client: true, lines: true, devis: { include: { lines: true } } },
    });
    return NextResponse.json(updated);
  }

  return NextResponse.json({ error: "Action invalide" }, { status: 400 });
}
