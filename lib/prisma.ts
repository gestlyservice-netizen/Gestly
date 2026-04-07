import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("[Prisma] DATABASE_URL is not set");
  }

  const pool = new Pool({
    connectionString,
    // Supabase requires SSL in production.
    // rejectUnauthorized: false accepts Supabase's self-signed cert.
    ssl: process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
    // Serverless: 1 connection per function instance avoids pool exhaustion.
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
