import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

// Validation des emails des clients dès la création et la modification
// (décision utilisateur, 2026-11-09). Routes réelles sur la base en mémoire ;
// aucune donnée Supabase, aucun appel externe.

const h = vi.hoisted(() => ({ clerkUserId: null as string | null }));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.clerkUserId })), currentUser: vi.fn(async () => null) }));

import { fakePrisma } from "@/tests/support/fake-prisma";
import { POST as createClientRoute } from "@/app/api/clients/route";
import { PUT as updateClientRoute } from "@/app/api/clients/[id]/route";
import { createClient, CreateClientError } from "@/lib/clients/create-client";
import { CLIENT_EMAIL_ERROR } from "@/lib/clients/client-email";

type R = Record<string, any>;
const seed = (model: string, data: R) => fakePrisma.seed(model, data) as R;
const rows = (model: string) => fakePrisma.rows(model) as R[];
const req = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let userA: R;
beforeEach(() => {
  fakePrisma.reset();
  for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  userA = seed("user", { clerkId: "clerk_A", email: "a@example.com", companyName: "Artisan A", stripeSubscriptionId: "sub_A", subscriptionStatus: "active" });
  h.clerkUserId = "clerk_A";
});

describe("POST /api/clients — création", () => {
  it("adresse valide : enregistrée nettoyée", async () => {
    const res = await createClientRoute(req({ name: "Client", email: "  client.test@example.com " }));
    expect(res.status).toBe(201);
    expect(rows("client")[0].email).toBe("client.test@example.com");
  });

  it("sans adresse : client créé sans email", async () => {
    expect((await createClientRoute(req({ name: "Client", email: "" }))).status).toBe(201);
    expect(rows("client")[0].email).toBeNull();
  });

  it.each(["client@", "a@example.com, b@example.com", "Nom <a@example.com>", "a@example.com\r\nBcc: b@example.com"])(
    "[régression] adresse invalide (%s) : 400 explicite, aucun client créé", async (email) => {
      const res = await createClientRoute(req({ name: "Client", email }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(CLIENT_EMAIL_ERROR);
      expect(rows("client")).toHaveLength(0);
    });
});

describe("PUT /api/clients/[id] — modification", () => {
  const ancienne = "a@example.com, b@example.com"; // fiche antérieure à la validation

  it("ancienne fiche à l'adresse invalide, adresse inchangée : nom modifiable, adresse conservée", async () => {
    const c = seed("client", { userId: userA.id, name: "Ancien", email: ancienne });
    const res = await updateClientRoute(req({ name: "Ancien renommé", email: ancienne }, "PUT"), { params: { id: c.id } });
    expect(res.status).toBe(200);
    expect(rows("client")[0]).toMatchObject({ name: "Ancien renommé", email: ancienne });
  });

  it("adresse modifiée invalide : 400, fiche inchangée", async () => {
    const c = seed("client", { userId: userA.id, name: "Client", email: "client@example.com" });
    const res = await updateClientRoute(req({ name: "Autre nom", email: "client@exemple" }, "PUT"), { params: { id: c.id } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(CLIENT_EMAIL_ERROR);
    expect(rows("client")[0]).toMatchObject({ name: "Client", email: "client@example.com" });
  });

  it("ancienne adresse corrigée ou effacée : acceptée", async () => {
    const c = seed("client", { userId: userA.id, name: "Ancien", email: ancienne });
    expect((await updateClientRoute(req({ name: "Ancien", email: "a@example.com" }, "PUT"), { params: { id: c.id } })).status).toBe(200);
    expect(rows("client")[0].email).toBe("a@example.com");
    expect((await updateClientRoute(req({ name: "Ancien", email: "" }, "PUT"), { params: { id: c.id } })).status).toBe(200);
    expect(rows("client")[0].email).toBeNull();
  });

  it("client d'un autre compte : 404 avant toute validation", async () => {
    const other = seed("user", { clerkId: "clerk_B", email: "b@example.com", companyName: "B", stripeSubscriptionId: "sub_B", subscriptionStatus: "active" });
    const c = seed("client", { userId: other.id, name: "Client B", email: "b.client@example.com" });
    expect((await updateClientRoute(req({ name: "x", email: "invalide" }, "PUT"), { params: { id: c.id } })).status).toBe(404);
  });
});

describe("createClient — règle partagée avec l'agent WhatsApp", () => {
  it("par défaut : adresse invalide refusée (EMAIL_INVALID)", async () => {
    await expect(createClient({ userId: userA.id, name: "C", email: "pas-une-adresse" })).rejects.toMatchObject({
      name: "CreateClientError", code: "EMAIL_INVALID",
    });
    expect(rows("client")).toHaveLength(0);
  });

  it("agent WhatsApp (invalidEmail: ignore) : client créé sans email, le devis n'est pas bloqué", async () => {
    const c = await createClient({ userId: userA.id, name: "C", email: "jean point dupont arobase", invalidEmail: "ignore" });
    expect(c.email).toBeNull();
    expect(readFileSync("lib/whatsapp/confirm-creation.ts", "utf8")).toContain('invalidEmail: "ignore"');
  });

  it("CreateClientError reste reconnue (nom manquant)", async () => {
    await expect(createClient({ userId: userA.id, name: " " })).rejects.toBeInstanceOf(CreateClientError);
  });
});

describe("[régression] formulaires : même règle que le serveur", () => {
  it("les trois formulaires de client utilisent normalizeClientEmail ; plus de z.string().email()", () => {
    for (const p of ["app/dashboard/clients/page.tsx", "app/dashboard/devis/nouveau/page.tsx", "app/dashboard/factures/nouveau/page.tsx"]) {
      const src = readFileSync(p, "utf8");
      expect(src).toContain("normalizeClientEmail");
      expect(src).not.toMatch(/z\.string\(\)\.email\(/);
    }
    // Modification : pas de validation native type="email" qui bloquerait une ancienne fiche.
    expect(readFileSync("app/dashboard/clients/page.tsx", "utf8")).toMatch(/id="email"\s+type="text"/);
  });
});
