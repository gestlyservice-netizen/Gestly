import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Recette : limitation de débit PARTAGÉE (table "RateLimitBucket") sur un
// PostgreSQL 17 LOCAL et temporaire (scripts/recette/m15-email-local.ps1, qui
// applique la migration 20261109_rate_limit_bucket_up.sql après l'avoir
// rejouée : up → down → up).
// Plusieurs « instances Vercel » sont simulées par des copies indépendantes
// des modules (vi.resetModules) : chacune a SON pool de connexions et SA
// mémoire, exactement comme des fonctions serverless distinctes.
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const url = process.env.GESTLY_RECETTE_PG ?? "";
  if (!/^postgresql:\/\/postgres@(localhost|127\.0\.0\.1):\d+\/gestly_recette$/.test(url)) {
    throw new Error("Recette refusée : base locale gestly_recette attendue (scripts/recette/m15-email-local.ps1).");
  }
  return { url, clients: [] as { $disconnect: () => Promise<void> }[] };
});

// Chaque copie du module @/lib/prisma = une instance avec son propre pool.
vi.mock("@/lib/prisma", async () => {
  const { Pool } = await import("pg");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: h.url, max: 4 })) });
  h.clients.push(prisma);
  return { prisma, default: prisma };
});
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

type Instance = {
  db: typeof import("@/lib/rate-limit-db");
  mem: typeof import("@/lib/rate-limit");
  prisma: typeof import("@/lib/prisma")["prisma"];
};
async function newInstance(): Promise<Instance> {
  vi.resetModules();
  return {
    db: await import("@/lib/rate-limit-db"),
    mem: await import("@/lib/rate-limit"),
    prisma: (await import("@/lib/prisma")).prisma,
  };
}

const lines: string[] = [];
const OUT = process.env.GESTLY_RECETTE_OUT ?? "";
let instances: Instance[] = [];

beforeAll(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  instances = [await newInstance(), await newInstance(), await newInstance()];
});

afterAll(async () => {
  if (OUT) fs.writeFileSync(path.join(OUT, "recette-rate-limit.md"), ["# Recette limitation de débit partagée", "", ...lines].join("\n"));
  await Promise.all(h.clients.map((c) => c.$disconnect()));
});

describe("Limitation de débit partagée (PostgreSQL local)", () => {
  it("L1 — migration appliquée : table, clé primaire, index, RLS activée", async () => {
    const [p] = instances;
    const [t] = await p.prisma.$queryRaw<{ rls: boolean; idx: number }[]>`
      SELECT c.relrowsecurity AS rls,
             (SELECT count(*)::int FROM pg_indexes WHERE tablename = 'RateLimitBucket') AS idx
      FROM pg_class c WHERE c.oid = to_regclass('public."RateLimitBucket"')`;
    expect(t.rls).toBe(true);
    expect(t.idx).toBe(2); // clé primaire + index sur expiresAt
    lines.push(`- L1 OK : table présente, RLS activée, ${t.idx} index`);
  });

  it("L2 — 3 instances × 10 requêtes SIMULTANÉES, limite 3 : exactement 3 acceptées au total", async () => {
    const key = "recette:concurrence";
    const calls = instances.flatMap((i) => Array.from({ length: 10 }, () => i.db.consumeRateLimit(key, 3, 60_000)));
    const results = await Promise.all(calls);
    expect(results.every((r) => r.source === "db")).toBe(true);
    expect(results.filter((r) => !r.limited)).toHaveLength(3);
    // Compteurs distincts 1..30 : aucune mise à jour perdue.
    expect(results.map((r) => r.count).sort((a, b) => a! - b!)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const [row] = await instances[0].prisma.$queryRaw<{ count: number }[]>`SELECT "count" FROM "RateLimitBucket" WHERE "key" = ${key}`;
    expect(row.count).toBe(30);
    lines.push(`- L2 OK : 30 requêtes simultanées sur 3 instances → ${results.filter((r) => !r.limited).length} acceptées, compteur final ${row.count}`);
  });

  it("L3 — témoin : l'ancienne limite en mémoire laisse passer 3 envois PAR instance (9 au lieu de 3)", async () => {
    const accepted = instances
      .flatMap((i) => Array.from({ length: 10 }, () => i.mem.isRateLimited("recette:memoire", 3, 60_000)))
      .filter((limited) => !limited).length;
    expect(accepted).toBe(9);
    lines.push(`- L3 OK (témoin) : en mémoire, ${accepted} acceptés sur 3 instances — c'est le défaut corrigé`);
  });

  it("L4 — fin de fenêtre : le compteur repart à 1 (horloge de la base)", async () => {
    const [p] = instances;
    const key = "recette:fenetre";
    const first = [];
    for (let i = 0; i < 4; i++) first.push((await p.db.consumeRateLimit(key, 3, 1_500)).limited);
    expect(first).toEqual([false, false, false, true]);
    await new Promise((r) => setTimeout(r, 1_700));
    const after = await p.db.consumeRateLimit(key, 3, 1_500);
    expect(after).toMatchObject({ limited: false, count: 1, source: "db" });
    lines.push("- L4 OK : 3 acceptés, 4e refusé, accepté de nouveau après la fenêtre (compteur 1)");
  });

  it("L5 — purge : seuls les compteurs expirés depuis plus d'un jour sont supprimés", async () => {
    const [p] = instances;
    await p.prisma.$executeRaw`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt")
      VALUES ('recette:vieux', 5, (now() AT TIME ZONE 'UTC') - interval '3 days', (now() AT TIME ZONE 'UTC') - interval '2 days')`;
    const before = await p.prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "RateLimitBucket"`;
    const purged = await p.db.purgeExpiredRateLimits();
    const keys = await p.prisma.$queryRaw<{ key: string }[]>`SELECT "key" FROM "RateLimitBucket" ORDER BY "key"`;
    expect(purged).toBe(1);
    expect(keys.map((k) => k.key)).not.toContain("recette:vieux");
    expect(keys.map((k) => k.key)).toContain("recette:concurrence");
    lines.push(`- L5 OK : ${before[0].n} lignes, 1 purgée (expirée depuis 2 jours), compteurs actifs conservés`);
  });

  it("L6 — limites des emails de documents sur la base partagée : 3 envois du même devis, toutes instances confondues", async () => {
    // 6 instances créées une à une (modules et pools distincts), puis 6 envois simultanés.
    const mods: (typeof import("@/lib/documents/document-email-limit"))[] = [];
    for (let i = 0; i < 6; i++) {
      vi.resetModules();
      mods.push(await import("@/lib/documents/document-email-limit"));
    }
    expect(new Set(mods).size).toBe(6);
    const results = await Promise.all(mods.map((m) => m.isDocumentEmailRateLimited("user_recette", "devis", "devis_recette")));
    expect(results.filter((limited) => !limited)).toHaveLength(3);
    lines.push("- L6 OK : 6 envois simultanés du même devis depuis 6 instances → 3 acceptés");
  });
});
