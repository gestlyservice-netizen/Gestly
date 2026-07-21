import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function getEventForUser(id: string, userId: string) {
  return prisma.event.findFirst({ where: { id, userId }, include: { client: { select: { id: true, name: true } } } });
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const existing = await getEventForUser(params.id, user.id);
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }
  const { title, description, address, startAt, endAt, clientId, reminderMinutesBefore } = body as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "Le titre est obligatoire" }, { status: 400 });
  }
  if (typeof startAt !== "string" || isNaN(Date.parse(startAt))) {
    return NextResponse.json({ error: "Date/heure de début invalide" }, { status: 400 });
  }
  if (typeof clientId === "string" && clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, userId: user.id } });
    if (!client) return NextResponse.json({ error: "Client introuvable" }, { status: 404 });
  }

  const event = await prisma.event.update({
    where: { id: params.id },
    data: {
      title: title.trim(),
      description: typeof description === "string" && description.trim() ? description.trim() : null,
      address: typeof address === "string" && address.trim() ? address.trim() : null,
      startAt: new Date(startAt),
      endAt: typeof endAt === "string" && endAt && !isNaN(Date.parse(endAt)) ? new Date(endAt) : null,
      clientId: typeof clientId === "string" && clientId ? clientId : null,
      reminderMinutesBefore:
        typeof reminderMinutesBefore === "number" ? reminderMinutesBefore : null,
    },
    include: { client: { select: { id: true, name: true } } },
  });

  return NextResponse.json(event);
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

  const existing = await getEventForUser(params.id, user.id);
  if (!existing) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 });

  await prisma.event.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
