import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, string> = {};

  // 1. Check environment variables
  checks.DATABASE_URL = process.env.DATABASE_URL
    ? "set (" + process.env.DATABASE_URL.split("@")[1]?.split("/")[0] + ")"
    : "MISSING";
  checks.CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    ? "set"
    : "MISSING";
  checks.CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY ? "set" : "MISSING";

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
    (v) => !v.startsWith("MISSING") && !v.startsWith("FAILED")
  );

  return NextResponse.json(
    { ok: allOk, checks },
    { status: allOk ? 200 : 503 }
  );
}
