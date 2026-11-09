import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Limitation de débit partagée : logique de repli et requête atomique.
// Base simulée ici ; l'atomicité RÉELLE (requêtes simultanées) est prouvée
// sur PostgreSQL 17 local par tests/recette/rate-limit.recette.ts.

const db = vi.hoisted(() => ({ $queryRaw: vi.fn(), $executeRaw: vi.fn() }));
const sentry = vi.hoisted(() => ({ captureMessage: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("@sentry/nextjs", () => sentry);

import { consumeRateLimit, purgeExpiredRateLimits, resetRateLimitDbState } from "@/lib/rate-limit-db";
import { clearRateLimits } from "@/lib/rate-limit";
import { isDocumentEmailRateLimited, DOCUMENT_EMAIL_LIMITS } from "@/lib/documents/document-email-limit";

// Texte SQL d'un appel à $queryRaw (gabarit étiqueté : morceaux + valeurs).
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimitDbState();
  clearRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("table présente : compteur PostgreSQL", () => {
  it("une requête INSERT … ON CONFLICT … RETURNING par passage ; refus au-delà de la limite", async () => {
    let n = 0;
    db.$queryRaw.mockImplementation(async (tpl: TemplateStringsArray) =>
      tpl.join("").includes("to_regclass") ? [{ present: true }] : [{ count: ++n }]);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit("k", 3, 600_000));
    expect(results.map((r) => r.limited)).toEqual([false, false, false, true]);
    expect(results.every((r) => r.source === "db")).toBe(true);
    const upserts = db.$queryRaw.mock.calls.filter((c) => !sqlOf(c).includes("to_regclass"));
    expect(upserts).toHaveLength(4);
    const sql = sqlOf(upserts[0]);
    expect(sql).toContain('INSERT INTO "RateLimitBucket"');
    expect(sql).toContain('ON CONFLICT ("key") DO UPDATE');
    expect(sql).toContain('RETURNING "count"');
    // Clé et fenêtre passées en paramètres (jamais concaténées dans le SQL).
    expect(upserts[0].slice(1)).toEqual(["k", 600_000]);
  });

  it("présence de la table vérifiée une fois, puis mémorisée", async () => {
    db.$queryRaw.mockImplementation(async (tpl: TemplateStringsArray) =>
      tpl.join("").includes("to_regclass") ? [{ present: true }] : [{ count: 1 }]);
    await consumeRateLimit("a", 3, 1000);
    await consumeRateLimit("b", 3, 1000);
    expect(db.$queryRaw.mock.calls.filter((c) => sqlOf(c).includes("to_regclass"))).toHaveLength(1);
  });
});

describe("repli en mémoire", () => {
  it("table absente (migration non appliquée) : limite en mémoire, signalée une seule fois", async () => {
    db.$queryRaw.mockResolvedValue([{ present: false }]);
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await consumeRateLimit("k", 3, 600_000));
    expect(results.map((r) => r.limited)).toEqual([false, false, false, true]);
    expect(results.every((r) => r.source === "memory")).toBe(true);
    expect(sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentry.captureMessage.mock.calls[0][0]).toMatch(/migration 20261109 non appliquée/);
  });

  it("base indisponible : repli en mémoire, aucune exception remontée", async () => {
    db.$queryRaw.mockRejectedValue(new Error("connexion refusée"));
    const r = await consumeRateLimit("k", 3, 600_000);
    expect(r).toEqual({ limited: false, count: null, source: "memory" });
  });

  it("table supprimée après vérification : erreur SQL → repli, présence revérifiée ensuite", async () => {
    let present = true;
    db.$queryRaw.mockImplementation(async (tpl: TemplateStringsArray) => {
      if (tpl.join("").includes("to_regclass")) return [{ present }];
      throw new Error('relation "RateLimitBucket" does not exist');
    });
    expect((await consumeRateLimit("k", 3, 1000)).source).toBe("memory");
    present = false;
    await consumeRateLimit("k", 3, 1000);
    expect(db.$queryRaw.mock.calls.filter((c) => sqlOf(c).includes("to_regclass"))).toHaveLength(2);
  });
});

describe("purgeExpiredRateLimits", () => {
  it("supprime les compteurs expirés depuis plus d'un jour ; rien si la table est absente", async () => {
    db.$queryRaw.mockResolvedValue([{ present: true }]);
    db.$executeRaw.mockResolvedValue(7);
    expect(await purgeExpiredRateLimits()).toBe(7);
    expect(sqlOf(db.$executeRaw.mock.calls[0])).toMatch(/DELETE FROM "RateLimitBucket" WHERE "expiresAt" </);

    resetRateLimitDbState();
    db.$queryRaw.mockResolvedValue([{ present: false }]);
    db.$executeRaw.mockClear();
    expect(await purgeExpiredRateLimits()).toBe(0);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("isDocumentEmailRateLimited (limites des emails de documents)", () => {
  beforeEach(() => db.$queryRaw.mockResolvedValue([{ present: false }]));

  it(`même document : ${DOCUMENT_EMAIL_LIMITS.perDocument.limit} envois puis refus`, async () => {
    const r = [];
    for (let i = 0; i <= DOCUMENT_EMAIL_LIMITS.perDocument.limit; i++) r.push(await isDocumentEmailRateLimited("u1", "devis", "d1"));
    expect(r).toEqual([false, false, false, true]);
  });

  it("devis et facture de même identifiant comptés séparément ; autre document libre", async () => {
    for (let i = 0; i < 4; i++) await isDocumentEmailRateLimited("u1", "devis", "x");
    expect(await isDocumentEmailRateLimited("u1", "facture", "x")).toBe(false);
    expect(await isDocumentEmailRateLimited("u1", "devis", "y")).toBe(false);
  });

  it(`compte : ${DOCUMENT_EMAIL_LIMITS.perAccount.limit} envois par heure ; autre compte libre ; document bloqué sans consommer le quota`, async () => {
    for (let i = 0; i < 20; i++) await isDocumentEmailRateLimited("u1", "devis", "spam"); // 3 comptés
    for (let i = 0; i < DOCUMENT_EMAIL_LIMITS.perAccount.limit - 3; i++) {
      expect(await isDocumentEmailRateLimited("u1", "facture", `f${i}`)).toBe(false);
    }
    expect(await isDocumentEmailRateLimited("u1", "facture", "dernier")).toBe(true);
    expect(await isDocumentEmailRateLimited("u2", "facture", "dernier")).toBe(false);
  });

  it("clés utilisées : par document et par compte", async () => {
    db.$queryRaw.mockImplementation(async (tpl: TemplateStringsArray) =>
      tpl.join("").includes("to_regclass") ? [{ present: true }] : [{ count: 1 }]);
    await isDocumentEmailRateLimited("u1", "facture", "f1");
    const keys = db.$queryRaw.mock.calls.filter((c) => !sqlOf(c).includes("to_regclass")).map((c) => c[1]);
    expect(keys).toEqual(["document-email:facture:f1", "document-email:account:u1"]);
  });
});
