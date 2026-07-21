import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_STAGES = ["nouveau", "qualification", "proposition", "negociation", "gagne", "perdu"];

async function getOpportunityForUser(id: string, userId: string) {
  return prisma.opportunity.findFirst({ where: { id, userId } });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const existing = await getOpportunityForUser(params.id, user.id);
  if (!existing) return NextResponse.json({ error: "Opportunité introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }
  const { title, clientId, amount, probability, stage, expectedCloseAt, notes } = body as Record<string, unknown>;

  const data: Record<string, unknown> = {};
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Le titre est obligatoire" }, { status: 400 });
    }
    data.title = title.trim();
  }
  if (stage !== undefined) {
    if (typeof stage !== "string" || !VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: "Étape invalide" }, { status: 400 });
    }
    data.stage = stage;
  }
  if (clientId !== undefined) {
    if (typeof clientId === "string" && clientId) {
      const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
      if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
      data.clientId = clientId;
    } else {
      data.clientId = null;
    }
  }
  if (amount !== undefined) data.amount = typeof amount === "number" ? amount : null;
  if (probability !== undefined) data.probability = typeof probability === "number" ? Math.min(100, Math.max(0, probability)) : 50;
  if (expectedCloseAt !== undefined) {
    data.expectedCloseAt =
      typeof expectedCloseAt === "string" && !isNaN(Date.parse(expectedCloseAt)) ? new Date(expectedCloseAt) : null;
  }
  if (notes !== undefined) data.notes = typeof notes === "string" && notes.trim() ? notes.trim() : null;

  const updated = await prisma.opportunity.update({
    where: { id: params.id },
    data,
    include: { client: { select: { id: true, name: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const existing = await getOpportunityForUser(params.id, user.id);
  if (!existing) return NextResponse.json({ error: "Opportunité introuvable" }, { status: 404 });

  await prisma.opportunity.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
