import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { runRelancesCheck } from "@/lib/relances/engine";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${cronSecret}`) return true;
  }
  const { userId } = await auth();
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  return user?.email === ADMIN_EMAIL;
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const summary = await runRelancesCheck();
  return NextResponse.json(summary);
}
