import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function buildConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("[Prisma] DATABASE_URL environment variable is not set");
  }
  if (process.env.NODE_ENV === "production") {
    const params: string[] = [];
    if (!url.includes("sslmode")) params.push("sslmode=require");
    // pgbouncer=true disables prepared statements, required for
    // Supabase transaction pooler (port 6543) with Prisma.
    if (!url.includes("pgbouncer") && url.includes("pooler.supabase.com")) {
      params.push("pgbouncer=true");
    }
    if (params.length > 0) {
      const separator = url.includes("?") ? "&" : "?";
      return `${url}${separator}${params.join("&")}`;
    }
  }
  return url;
}

function createPrismaClient(): PrismaClient {
  const connectionString = buildConnectionString();
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// In development, reuse the same instance across hot-reloads.
if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
