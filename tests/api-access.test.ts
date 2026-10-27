import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Balayage de TOUTES les routes API (recette V1, blocs 1 et 7) :
//   - sans connexion : refus, aucune lecture ni écriture de données ;
//   - abonnement suspendu : 402 (sauf les routes qui servent à se réabonner) ;
//   - isolement : toute requête qui vise un identifiant reçu dans l'URL est
//     filtrée par le compte connecté (anti-IDOR).
// Une nouvelle route est couverte automatiquement ; une exception doit être
// ajoutée explicitement ci-dessous, avec sa justification.

type Call = { model: string; method: string; args: unknown };
const calls: Call[] = [];
const state: { clerkId: string | null; user: Record<string, unknown> | null } = { clerkId: null, user: null };

vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ userId: state.clerkId }),
  currentUser: async () => null,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getCurrentUser: async () => state.user };
});

// Base simulée : lectures vides, chaque appel enregistré.
vi.mock("@/lib/prisma", () => {
  const empty = (method: string) =>
    method === "findMany" ? [] :
    method === "count" ? 0 :
    method.startsWith("aggregate") ? { _sum: {}, _count: 0 } :
    method === "groupBy" ? [] :
    method.startsWith("find") ? null :
    { count: 0 };
  const model = (name: string) =>
    new Proxy({}, {
      get: (_t, method: string) => async (args: unknown) => {
        calls.push({ model: name, method, args });
        return empty(method);
      },
    });
  const prisma: Record<string, unknown> = new Proxy({}, {
    get: (_t, key: string) => {
      if (key === "$transaction") {
        return async (arg: unknown) => (typeof arg === "function" ? arg(prisma) : Promise.all(arg as Promise<unknown>[]));
      }
      if (key === "$queryRaw" || key === "$executeRaw" || key === "$queryRawUnsafe" || key === "$executeRawUnsafe") {
        return async () => { calls.push({ model: "$raw", method: key, args: null }); return []; };
      }
      if (key === "then") return undefined;
      return model(key);
    },
  });
  return { prisma, default: prisma };
});

const API_DIR = join(process.cwd(), "app", "api");
function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}
const ROUTES = routeFiles(API_DIR).map((file) => ({
  file,
  path: "/api/" + relative(API_DIR, file).split(sep).slice(0, -1).join("/"),
}));
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

// Routes publiques par conception, protégées autrement (middleware.ts).
const PUBLIC = new Map<string, string>([
  ["/api/health", "contrôle de santé, sans donnée d'utilisateur"],
  ["/api/public/devis/[id]", "lien de devis partagé au client (identifiant non devinable, champs en liste blanche : tests/public-devis.test.ts)"],
  ["/api/stripe/webhook", "signature Stripe (lib/stripe-webhook.test.ts)"],
  ["/api/whatsapp/webhook", "signature Meta (lib/whatsapp)"],
]);
// Accessibles avec un abonnement suspendu : elles servent à se réabonner ou
// à régulariser un impayé.
const ALLOWED_WHEN_BLOCKED = new Set(["/api/stripe/create-checkout-session", "/api/stripe/create-portal-session"]);

const OTHER_ID = "ressource_autre_compte";
const params = { params: { id: OTHER_ID } };
const request = (method: string, path: string) =>
  new Request(`http://localhost:3000${path.replace("[id]", OTHER_ID)}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify({ clientId: "c1", lines: [], status: "signe", reason: "x", message: "x" }) }),
  });

async function handlers() {
  const out: { path: string; method: string; fn: (req: Request, ctx: unknown) => Promise<Response> }[] = [];
  for (const r of ROUTES) {
    const mod = (await import(/* @vite-ignore */ r.file)) as Record<string, unknown>;
    for (const m of METHODS) if (typeof mod[m] === "function") out.push({ path: r.path, method: m, fn: mod[m] as never });
  }
  return out;
}

const WRITE = /^(create|update|upsert|delete)/;
const activeUser = { id: "user_a", clerkId: "clerk_a", email: "a@example.com", stripeSubscriptionId: "sub_a", subscriptionStatus: "active" };

beforeEach(() => {
  calls.length = 0;
  state.clerkId = null;
  state.user = null;
});

describe("routes API — inventaire", () => {
  it("toutes les routes sont trouvées (garde-fou du balayage)", async () => {
    const all = await handlers();
    expect(ROUTES.length).toBeGreaterThanOrEqual(38);
    expect(all.length).toBeGreaterThanOrEqual(50);
  });
});

describe("routes API — sans connexion", () => {
  it("chaque route non publique refuse, sans lire ni écrire de données utilisateur", async () => {
    const failures: string[] = [];
    for (const h of await handlers()) {
      if (PUBLIC.has(h.path)) continue;
      calls.length = 0;
      const res = await h.fn(request(h.method, h.path), params);
      const touched = calls.filter((c) => !(c.model === "user" && c.method === "findUnique"));
      if (![401, 403].includes(res.status) || touched.length) {
        failures.push(`${h.method} ${h.path} → ${res.status}${touched.length ? `, données lues/écrites : ${touched.map((c) => `${c.model}.${c.method}`).join(", ")}` : ""}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("routes API — abonnement suspendu", () => {
  it.each([
    ["sans abonnement", { stripeSubscriptionId: null, subscriptionStatus: "inactive" }],
    ["résilié", { stripeSubscriptionId: "sub_a", subscriptionStatus: "canceled" }],
    ["impayé", { stripeSubscriptionId: "sub_a", subscriptionStatus: "past_due" }],
  ])("%s : 402 et aucune écriture sur les routes de l'application", async (_label, sub) => {
    state.clerkId = "clerk_a";
    state.user = { ...activeUser, ...sub };
    const failures: string[] = [];
    for (const h of await handlers()) {
      if (PUBLIC.has(h.path) || ALLOWED_WHEN_BLOCKED.has(h.path) || CRON_OR_ADMIN.has(h.path)) continue;
      calls.length = 0;
      const res = await h.fn(request(h.method, h.path), params);
      const writes = calls.filter((c) => WRITE.test(c.method));
      if (res.status !== 402 || writes.length) failures.push(`${h.method} ${h.path} → ${res.status}${writes.length ? " (écriture)" : ""}`);
    }
    expect(failures).toEqual([]);
  });
});

// Routes réservées au cron (CRON_SECRET) ou à l'administrateur : couvertes par
// le test « sans connexion » ; pour un artisan connecté, refus vérifié ci-dessous.
const CRON_OR_ADMIN = new Set([
  "/api/admin/ovh-balance/check",
  "/api/admin/ovh-balance/history",
  "/api/relances/check",
  "/api/stripe/resync",
  "/api/whatsapp/process-pending",
]);

describe("routes API — cron et administration", () => {
  it("un artisan connecté (non administrateur) est refusé", async () => {
    state.clerkId = "clerk_a";
    state.user = activeUser;
    const failures: string[] = [];
    for (const h of await handlers()) {
      if (!CRON_OR_ADMIN.has(h.path)) continue;
      calls.length = 0;
      const res = await h.fn(request(h.method, h.path), params);
      const writes = calls.filter((c) => WRITE.test(c.method));
      if (![401, 403].includes(res.status) || writes.length) failures.push(`${h.method} ${h.path} → ${res.status}`);
    }
    expect(failures).toEqual([]);
  });
});

describe("routes API — isolement des comptes (identifiant d'un autre compte)", () => {
  it("chaque requête sur l'identifiant de l'URL est filtrée par le compte connecté ; réponse 404, aucune écriture", async () => {
    state.clerkId = "clerk_a";
    state.user = activeUser;
    const failures: string[] = [];
    for (const h of await handlers()) {
      if (!h.path.includes("[id]") || PUBLIC.has(h.path)) continue;
      calls.length = 0;
      const res = await h.fn(request(h.method, h.path), params);
      const onId = calls.filter((c) => JSON.stringify(c.args ?? null).includes(OTHER_ID));
      const unscoped = onId.filter((c) => !/"userId":"user_a"|"clerkId":"clerk_a"/.test(JSON.stringify(c.args)));
      const writes = calls.filter((c) => WRITE.test(c.method));
      if (res.status !== 404 || unscoped.length || writes.length || onId.length === 0) {
        failures.push(
          `${h.method} ${h.path} → ${res.status}` +
          (unscoped.length ? `, requête non filtrée : ${unscoped.map((c) => `${c.model}.${c.method}`).join(", ")}` : "") +
          (writes.length ? ", écriture" : "") +
          (onId.length === 0 ? ", identifiant jamais vérifié" : "")
        );
      }
    }
    expect(failures).toEqual([]);
  });
});
