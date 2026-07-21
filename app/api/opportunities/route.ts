import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const opportunities = await prisma.opportunity.findMany({
    where: { userId: user.id },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(opportunities);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }
  const { title, clientId, amount, probability, expectedCloseAt, notes } = body as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Le titre est obligatoire" }, { status: 400 });
  }
  if (typeof clientId === "string" && clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
    if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  const opportunity = await prisma.opportunity.create({
    data: {
      userId: user.id,
      clientId: typeof clientId === "string" && clientId ? clientId : null,
      title: title.trim(),
      amount: typeof amount === "number" ? amount : null,
      probability: typeof probability === "number" ? Math.min(100, Math.max(0, probability)) : 50,
      expectedCloseAt:
        typeof expectedCloseAt === "string" && !isNaN(Date.parse(expectedCloseAt))
          ? new Date(expectedCloseAt)
          : null,
      notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    },
    include: { client: { select: { id: true, name: true } } },
  });

  return NextResponse.json(opportunity, { status: 201 });
}
