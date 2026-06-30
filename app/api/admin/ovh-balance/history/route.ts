import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (user?.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const alerts = await prisma.ovhBalanceAlert.findMany({
    orderBy: { alertSentAt: "desc" },
    take: 50,
  });

  return NextResponse.json(alerts);
}
