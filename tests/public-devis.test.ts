import { describe, it, expect, vi, beforeEach } from "vitest";

// Lien public d'un devis (/d/:id → /print/devis/:id → /api/public/devis/:id) :
// la réponse est lisible par quiconque possède le lien.

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  auth: vi.fn(async () => ({ userId: null as string | null })),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { devis: { findUnique: mocks.findUnique } } }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));

import { GET } from "@/app/api/public/devis/[id]/route";

const SENSITIVE = ["email", "clerkId", "stripeCustomerId", "stripeSubscriptionId", "subscriptionStatus", "plan",
  "signatureIp", "signatureUserAgent", "signatureHash", "userId", "prochainNumeroDevis", "prochainNumeroFacture"];

function devis(extra: object = {}) {
  return {
    id: "dev_1", number: "DEV-2026-001", status: "envoye", totalHT: 100, totalTVA: 20, totalTTC: 120,
    validityDays: 30, notes: null, createdAt: new Date(), sentAt: new Date(),
    linkRevoked: false, linkExpiresAt: null,
    client: { name: "Client Fictif", email: "client@example.com", phone: null, address: null },
    lines: [],
    user: { clerkId: "clerk_owner", settings: { companyName: "Artisan Fictif" } },
    ...extra,
  };
}

const call = () => GET(new Request("http://localhost/api/public/devis/dev_1"), { params: { id: "dev_1" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: null });
});

describe("GET /api/public/devis/:id", () => {
  it("[régression] ne demande jamais à la base les données du compte de l'artisan", async () => {
    mocks.findUnique.mockResolvedValue(devis());
    await call();
    const { select } = mocks.findUnique.mock.calls[0][0];
    expect(select).toBeDefined();
    const userSelect = select.user.select;
    for (const key of SENSITIVE) {
      expect(select[key], `devis.${key}`).toBeUndefined();
      // clerkId : lu pour reconnaître le propriétaire, retiré de la réponse (test suivant).
      if (key !== "clerkId") expect(userSelect[key], `user.${key}`).toBeUndefined();
      expect(userSelect.settings.select[key], `settings.${key}`).toBeUndefined();
    }
  });

  it("réponse : devis, client et paramètres d'impression, sans clerkId", async () => {
    mocks.findUnique.mockResolvedValue(devis());
    const res = await call();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ settings: { companyName: "Artisan Fictif" } });
    expect(JSON.stringify(body)).not.toContain("clerk_owner");
  });

  it("lien révoqué ou expiré : 403 pour un visiteur, accessible au propriétaire", async () => {
    mocks.findUnique.mockResolvedValue(devis({ linkRevoked: true }));
    expect((await call()).status).toBe(403);
    mocks.findUnique.mockResolvedValue(devis({ linkExpiresAt: new Date(Date.now() - 1000) }));
    expect((await call()).status).toBe(403);
    mocks.auth.mockResolvedValue({ userId: "clerk_owner" });
    expect((await call()).status).toBe(200);
  });

  it("devis inexistant : 404", async () => {
    mocks.findUnique.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});
