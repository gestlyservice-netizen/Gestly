import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const events = await prisma.event.findMany({
    where: {
      userId: user.id,
      ...(from && to ? { startAt: { gte: new Date(from), lte: new Date(to) } } : {}),
    },
    include: { client: { select: { id: true, name: true } } },
    orderBy: { startAt: "asc" },
  });

  return NextResponse.json(events);
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

  const event = await prisma.event.create({
    data: {
      userId: user.id,
      clientId: typeof clientId === "string" && clientId ? clientId : null,
      title: title.trim(),
      description: typeof description === "string" && description.trim() ? description.trim() : null,
      address: typeof address === "string" && address.trim() ? address.trim() : null,
      startAt: new Date(startAt),
      endAt: typeof endAt === "string" && endAt && !isNaN(Date.parse(endAt)) ? new Date(endAt) : null,
      reminderMinutesBefore:
        typeof reminderMinutesBefore === "number" ? reminderMinutesBefore : null,
    },
    include: { client: { select: { id: true, name: true } } },
  });

  return NextResponse.json(event, { status: 201 });
}
