import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_DELAI = 365;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

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

  // Délais en jours après échéance : entiers de 1 à 365, strictement
  // croissants. Avant : 10 / 3 / 21 était accepté (relance J2 avant J1), et
  // 3,5 faisait échouer l'enregistrement (colonne entière) avec une erreur 500.
  const delai = (v: unknown, defaut: number) => (v === undefined || v === null || v === "" ? defaut : Number(v));
  const [delaiJ1, delaiJ2, delaiJ3] = [delai(body.delaiJ1, 3), delai(body.delaiJ2, 10), delai(body.delaiJ3, 21)];
  if (![delaiJ1, delaiJ2, delaiJ3].every((d) => Number.isInteger(d) && d >= 1 && d <= MAX_DELAI)) {
    return NextResponse.json({ error: `Les délais doivent être des nombres entiers de jours, entre 1 et ${MAX_DELAI}.` }, { status: 400 });
  }
  if (!(delaiJ1 < delaiJ2 && delaiJ2 < delaiJ3)) {
    return NextResponse.json({ error: "Les délais doivent être croissants : 1re relance < 2e relance < 3e relance." }, { status: 400 });
  }

  const data = {
    enabled: Boolean(body.enabled),
    delaiJ1,
    delaiJ2,
    delaiJ3,
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
