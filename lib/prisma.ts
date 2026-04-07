import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[Prisma] DATABASE_URL environment variable is not set");
  }

  // Strip `sslmode` from the URL — pg parses it and overrides the explicit
  // ssl option below, causing "self-signed certificate" errors on Supabase.
  // We handle TLS entirely via the ssl object instead.
  let cleanConnectionString = connectionString;
  try {
    const url = new URL(connectionString);
    url.searchParams.delete("sslmode");
    cleanConnectionString = url.toString();
  } catch {
    // If parsing fails, use original string and hope for the best.
  }

  const pool = new Pool({
    connectionString: cleanConnectionString,
    // Supabase uses a self-signed TLS certificate.
    // rejectUnauthorized: false accepts it without needing the CA bundle.
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
    // One connection per serverless instance avoids pool exhaustion.
    max: 1,
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// In development, reuse the same instance across hot-reloads.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
