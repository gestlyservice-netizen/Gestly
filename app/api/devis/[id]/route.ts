import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getDevisForUser(id: string, userId: string) {
  return prisma.devis.findFirst({
    where: { id, userId },
    include: { client: true, lines: true },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await getDevisForUser(params.id, user.id);
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  return NextResponse.json(devis);
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await getDevisForUser(params.id, user.id);
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const { status } = await request.json();
  const validStatuses = ["brouillon", "envoye", "signe", "refuse"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
  }

  const updated = await prisma.devis.update({
    where: { id: params.id },
    data: {
      status,
      sentAt: status === "envoye" && !devis.sentAt ? new Date() : devis.sentAt,
      signedAt: status === "signe" && !devis.signedAt ? new Date() : devis.signedAt,
    },
    include: { client: true, lines: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await getDevisForUser(params.id, user.id);
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  await prisma.devis.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
