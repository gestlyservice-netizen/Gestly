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
  // Supabase requires SSL from cloud environments (Vercel).
  // Append sslmode=require if not already present in the URL.
  if (process.env.NODE_ENV === "production" && !url.includes("sslmode")) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}sslmode=require`;
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
