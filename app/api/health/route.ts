import { NextResponse } from "next/server";

// Never statically generated — this route hits the DB and must run at runtime only.
export const dynamic = "force-dynamic";

export async function GET() {
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
    checks.database =
      "FAILED: " + (err instanceof Error ? err.message : String(err));
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
