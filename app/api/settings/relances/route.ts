import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const settings = await prisma.relanceSettings.findUnique({ where: { userId: user.id } });
  return NextResponse.json(
    settings ?? {
      enabled: false,
      delaiJ1: 3,
      delaiJ2: 10,
      delaiJ3: 21,
      canalEmail: true,
      canalSms: false,
      messageJ1: null,
      messageJ2: null,
      messageJ3: null,
    }
  );
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const data = {
    enabled: Boolean(body.enabled),
    delaiJ1: Math.max(1, Number(body.delaiJ1) || 3),
    delaiJ2: Math.max(1, Number(body.delaiJ2) || 10),
    delaiJ3: Math.max(1, Number(body.delaiJ3) || 21),
    canalEmail: Boolean(body.canalEmail),
    canalSms: Boolean(body.canalSms),
    messageJ1: typeof body.messageJ1 === "string" && body.messageJ1.trim() ? body.messageJ1 : null,
    messageJ2: typeof body.messageJ2 === "string" && body.messageJ2.trim() ? body.messageJ2 : null,
    messageJ3: typeof body.messageJ3 === "string" && body.messageJ3.trim() ? body.messageJ3 : null,
  };

  const settings = await prisma.relanceSettings.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
  });

  return NextResponse.json(settings);
}
