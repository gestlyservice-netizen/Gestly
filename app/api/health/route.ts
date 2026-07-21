import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";

// Never statically generated — this route hits the DB and must run at runtime only.
export const dynamic = "force-dynamic";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

function isCronInvocation(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

async function alertDatabaseDown(detail: string) {
  Sentry.captureMessage(`[health] Base de données injoignable : ${detail}`, "error");

  if (!process.env.RESEND_API_KEY) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>",
      to: ADMIN_EMAIL,
      subject: "🚨 Gestly — Base de données injoignable",
      html: `<p>Le contrôle de santé quotidien a détecté que la base de données est injoignable.</p><p><strong>Détail :</strong> ${detail}</p>`,
    });
  } catch (err) {
    console.error("[health] Échec de l'envoi de l'alerte email:", err);
  }
}

export async function GET(request: Request) {
  const checks: Record<string, string> = {};

  // 1. Check environment variables
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    checks.DATABASE_URL = "MISSING";
  } else {
    try {
      const parsed = new URL(dbUrl);
      checks.DATABASE_URL = `set (host: ${parsed.hostname}, port: ${parsed.port || "5432"}, ssl: ${parsed.searchParams.get("sslmode") ?? "not set"})`;
    } catch {
      checks.DATABASE_URL = "set but INVALID FORMAT (not a valid URL)";
    }
  }

  checks.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? "set"
    : "MISSING";
  checks.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ? "set" : "MISSING";
  checks.NODE_ENV = process.env.NODE_ENV ?? "undefined";

  // 2. Test database connection
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "connected";
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    checks.database = "FAILED: " + detail;
    // N'alerter que lors de l'invocation par le cron programmé, pas à chaque
    // appel public, pour éviter le spam si la route est sollicitée manuellement.
    if (isCronInvocation(request)) {
      await alertDatabaseDown(detail);
    }
  }

  // 3. Test Clerk auth module
  try {
    await import("@clerk/nextjs/server");
    checks.clerk = "loaded";
  } catch (err) {
    checks.clerk =
      "FAILED: " + (err instanceof Error ? err.message : String(err));
  }

  const allOk = Object.values(checks).every(
    (v) => !v.startsWith("MISSING") && !v.startsWith("FAILED") && !v.includes("INVALID")
  );

  return NextResponse.json(
    { ok: allOk, checks },
    { status: allOk ? 200 : 503 }
  );
}
