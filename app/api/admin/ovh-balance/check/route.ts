import { NextResponse } from "next/server";
import { Resend } from "resend";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { getOvhSmsBalance } from "@/lib/ovh-balance";

const ADMIN_EMAIL = "gestlyservice@gmail.com";
const WINDOW_MS   = 24 * 60 * 60 * 1000;

const THRESHOLDS = [
  {
    limit:   100,
    subject: "🚨 Gestly - Solde SMS OVH critique (moins de 100 crédits)",
  },
  {
    limit:   500,
    subject: "⚠️ Gestly - Solde SMS OVH bas (moins de 500 crédits)",
  },
] as const;

function alertBody(creditsLeft: number) {
  return `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px">
  <h2 style="margin:0 0 16px">Surveillance SMS OVH — Gestly</h2>
  <p>Solde actuel&nbsp;: <strong style="font-size:24px">${creditsLeft} crédits</strong></p>
  <p>
    <a href="https://www.manager.eu.ovhcloud.com/telecom/sms"
       style="display:inline-block;background:#0066cc;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
      Recharger sur OVH Manager →
    </a>
  </p>
</div>`;
}

async function isAuthorized(request: Request): Promise<boolean> {
  // Vercel cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${cronSecret}`) return true;
  }

  // Authenticated admin
  const { userId } = await auth();
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  return user?.email === ADMIN_EMAIL;
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  let balance;
  try {
    balance = await getOvhSmsBalance();
  } catch (err) {
    console.error("OVH balance check failed:", err);
    return NextResponse.json({ error: "Impossible de contacter l'API OVH" }, { status: 502 });
  }

  const { creditsLeft } = balance;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const alertsSent: number[] = [];

  for (const { limit, subject } of THRESHOLDS) {
    if (creditsLeft >= limit) continue;

    const recent = await prisma.ovhBalanceAlert.findFirst({
      where: {
        threshold:   limit,
        alertSentAt: { gte: new Date(Date.now() - WINDOW_MS) },
      },
    });
    if (recent) continue;

    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>",
        to:   ADMIN_EMAIL,
        subject,
        html: alertBody(creditsLeft),
      });
    } catch (err) {
      console.error(`Resend alert (threshold ${limit}) failed:`, err);
    }

    await prisma.ovhBalanceAlert.create({ data: { creditsLeft, threshold: limit } });
    alertsSent.push(limit);
  }

  return NextResponse.json({ creditsLeft, lastChecked: balance.lastChecked, alertsSent });
}
