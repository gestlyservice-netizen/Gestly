import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createDevis, CreateDevisError } from "@/lib/devis/create-devis";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

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
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const body = await request.json();
  const { clientId, validityDays, notes, lines, status } = body;

  try {
    const devis = await createDevis({
      userId: user.id,
      clientId,
      validityDays: Number(validityDays) || 30,
      notes,
      status,
      lines,
    });
    return NextResponse.json(devis, { status: 201 });
  } catch (err) {
    if (err instanceof CreateDevisError) {
      const httpStatus = err.code === "CLIENT_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status: httpStatus });
    }
    throw err;
  }
}
