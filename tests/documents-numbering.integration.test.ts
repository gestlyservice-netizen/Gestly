import { describe, it, expect, vi, beforeEach } from "vitest";

// Numérotation et règles des documents (devis, factures, avoirs) au niveau
// des ROUTES réelles : interface web, transformation devis → facture,
// avoirs, Paramètres, suppression de client, et canal WhatsApp.
// Base en mémoire (tests/support/fake-prisma.ts) avec verrous consultatifs
// réellement bloquants ; aucune donnée Supabase, aucun appel externe.

const h = vi.hoisted(() => ({ clerkUserId: null as string | null }));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.clerkUserId })), currentUser: vi.fn(async () => null) }));

import { fakePrisma } from "@/tests/support/fake-prisma";
import { POST as createFacture } from "@/app/api/factures/route";
import { POST as toFacture } from "@/app/api/devis/[id]/to-facture/route";
import { POST as createAvoir } from "@/app/api/factures/[id]/avoir/route";
import { POST as createDevisWeb } from "@/app/api/devis/route";
import { POST as duplicateDevis } from "@/app/api/devis/[id]/duplicate/route";
import { DELETE as deleteClient } from "@/app/api/clients/[id]/route";
import { GET as getSettings, POST as saveSettings } from "@/app/api/settings/route";
import { confirmDevisCreation } from "@/lib/whatsapp/confirm-creation";
import { emptyPendingDevis, type PendingDevis } from "@/lib/whatsapp/pending-devis";

const YEAR = new Date().getFullYear();
const num = (code: "DEV" | "FAC" | "AV", seq: number) => `${code}-${YEAR}-${String(seq).padStart(3, "0")}`;

let userA: Record<string, any>;
const seed = (model: string, data: Record<string, unknown>) => fakePrisma.seed(model, data) as Record<string, any>;
let userB: Record<string, any>;
let clientA: Record<string, any>;

const rows = (model: string) => fakePrisma.rows(model) as Record<string, any>[];
const as = (user: Record<string, any>) => { h.clerkUserId = user.clerkId; };
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const LINE = { description: "Prestation fictive", quantity: 1, unitPriceHT: 100, tvaRate: 20 };

function seedFacture(userId: string, number: string, totalHT = 100) {
  const facture = seed("facture", {
    userId, clientId: clientA.id, number, totalHT, totalTVA: totalHT * 0.2, totalTTC: totalHT * 1.2,
  });
  seed("factureLine", { factureId: facture.id, description: "Prestation", quantity: 1, unitPriceHT: totalHT, tvaRate: 20, totalHT });
  return facture;
}

beforeEach(() => {
  fakePrisma.reset();
  h.clerkUserId = null;
  userA = seed("user", { clerkId: "clerk_A", email: "a@example.com", companyName: "Artisan A", stripeSubscriptionId: "sub_A", subscriptionStatus: "active" });
  userB = seed("user", { clerkId: "clerk_B", email: "b@example.com", companyName: "Artisan B", stripeSubscriptionId: "sub_B", subscriptionStatus: "active" });
  clientA = seed("client", { userId: userA.id, name: "Client fictif A", phone: "06 22 22 22 22" });
  for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

describe("factures — interface web", () => {
  it("créations simultanées : numéros uniques et consécutifs", async () => {
    as(userA);
    const responses = await Promise.all(Array.from({ length: 8 }, () => createFacture(post({ clientId: clientA.id, lines: [LINE] }))));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(rows("facture").map((f) => f.number).sort()).toEqual(Array.from({ length: 8 }, (_, i) => num("FAC", i + 1)));
  });

  it("préfixe et « Prochain n° » enregistrés dans les Paramètres : appliqués, puis le paramètre avance", async () => {
    as(userA);
    await saveSettings(post({ companyName: "Artisan A", prefixeFacture: "FA-2026-", prochainNumeroFacture: 42 }));
    const res = await createFacture(post({ clientId: clientA.id, lines: [LINE] }));
    expect((await res.json()).number).toBe("FA-2026-042");
    expect((await (await getSettings()).json()).prochainNumeroFacture).toBe(43);
  });

  it("échec pendant la création : 500, rien d'émis, la reprise obtient le même numéro (jamais consommé)", async () => {
    as(userA);
    fakePrisma.failNext("facture.create", new Error("panne base"));
    expect((await createFacture(post({ clientId: clientA.id, lines: [LINE] }))).status).toBe(500);
    expect(rows("facture")).toHaveLength(0);
    expect((await (await createFacture(post({ clientId: clientA.id, lines: [LINE] }))).json()).number).toBe(num("FAC", 1));
  });

  it("isolation : le client d'un autre artisan est refusé ; chaque artisan a sa propre série", async () => {
    seedFacture(userA.id, num("FAC", 5));
    as(userB);
    expect((await createFacture(post({ clientId: clientA.id, lines: [LINE] }))).status).toBe(404);
    const clientB = seed("client", { userId: userB.id, name: "Client fictif B" });
    expect((await (await createFacture(post({ clientId: clientB.id, lines: [LINE] }))).json()).number).toBe(num("FAC", 1));
  });
});

describe("transformation devis → facture", () => {
  const seedSignedDevis = () =>
    seed("devis", { userId: userA.id, clientId: clientA.id, number: num("DEV", 1), status: "signe", totalHT: 100, totalTVA: 20, totalTTC: 120 });

  it("[régression] double clic simultané : une seule facture, le second reçoit 409", async () => {
    const devis = seedSignedDevis();
    as(userA);
    const [r1, r2] = await Promise.all([toFacture(post({}), ctx(devis.id)), toFacture(post({}), ctx(devis.id))]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(rows("facture")).toHaveLength(1);
    expect(rows("devis")[0].status).toBe("facture");
  });

  it("partage la série des factures créées depuis l'interface web", async () => {
    const devis = seedSignedDevis();
    as(userA);
    await createFacture(post({ clientId: clientA.id, lines: [LINE] }));
    expect((await (await toFacture(post({}), ctx(devis.id))).json()).number).toBe(num("FAC", 2));
  });

  it("devis non signé : refusé, aucun numéro consommé", async () => {
    const devis = seed("devis", { userId: userA.id, clientId: clientA.id, number: num("DEV", 1), status: "envoye" });
    as(userA);
    expect((await toFacture(post({}), ctx(devis.id))).status).toBe(400);
    expect((await (await createFacture(post({ clientId: clientA.id, lines: [LINE] }))).json()).number).toBe(num("FAC", 1));
  });
});

describe("avoirs — numérotation et règles de correction", () => {
  it("avoir total : numéroté AV-, puis un second avoir sur la même facture est refusé", async () => {
    const facture = seedFacture(userA.id, num("FAC", 1));
    as(userA);
    const first = await createAvoir(post({ type: "total", reason: "Annulation" }), ctx(facture.id));
    expect(first.status).toBe(201);
    expect((await first.json()).number).toBe(num("AV", 1));

    const second = await createAvoir(post({ type: "total", reason: "Doublon" }), ctx(facture.id));
    expect(second.status).toBe(409);
    expect(rows("avoir")).toHaveLength(1);
  });

  it("[régression] avoirs partiels : jamais au-delà du montant facturé", async () => {
    const facture = seedFacture(userA.id, num("FAC", 1), 100); // 120 € TTC
    as(userA);
    expect((await createAvoir(post({ type: "partiel", reason: "Geste", description: "Remise", unitPriceHT: 60, tvaRate: 20 }), ctx(facture.id))).status).toBe(201); // 72 TTC
    expect((await createAvoir(post({ type: "partiel", reason: "Geste", description: "Remise", unitPriceHT: 50, tvaRate: 20 }), ctx(facture.id))).status).toBe(409); // 60 > 48 restants
    expect((await createAvoir(post({ type: "partiel", reason: "Solde", description: "Solde", unitPriceHT: 40, tvaRate: 20 }), ctx(facture.id))).status).toBe(201); // 48 = solde
    expect((await createAvoir(post({ type: "total", reason: "Total" }), ctx(facture.id))).status).toBe(409);
    expect(rows("avoir").map((a) => a.number).sort()).toEqual([num("AV", 1), num("AV", 2)]);
  });

  it("[régression] deux avoirs simultanés qui dépasseraient ensemble la facture : un seul accepté", async () => {
    const facture = seedFacture(userA.id, num("FAC", 1), 100);
    as(userA);
    const body = post({ type: "partiel", reason: "Remise", description: "Remise", unitPriceHT: 70, tvaRate: 20 });
    const responses = await Promise.all([
      createAvoir(body.clone(), ctx(facture.id)),
      createAvoir(body.clone(), ctx(facture.id)),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(rows("avoir")).toHaveLength(1);
  });

  it("avoirs concurrents sur des factures différentes : numéros uniques", async () => {
    const f1 = seedFacture(userA.id, num("FAC", 1));
    const f2 = seedFacture(userA.id, num("FAC", 2));
    const f3 = seedFacture(userA.id, num("FAC", 3));
    as(userA);
    await Promise.all([f1, f2, f3].map((f) => createAvoir(post({ type: "total", reason: "Annulation" }), ctx(f.id))));
    expect(rows("avoir").map((a) => a.number).sort()).toEqual([num("AV", 1), num("AV", 2), num("AV", 3)]);
  });

  it("isolation : avoir sur la facture d'un autre artisan → 404", async () => {
    const facture = seedFacture(userA.id, num("FAC", 1));
    as(userB);
    expect((await createAvoir(post({ type: "total", reason: "x" }), ctx(facture.id))).status).toBe(404);
  });
});

describe("suppression d'un client", () => {
  it("[régression] client avec factures : suppression refusée, factures conservées, numéros jamais libérés", async () => {
    seedFacture(userA.id, num("FAC", 1));
    as(userA);
    const res = await deleteClient(new Request("http://localhost/x", { method: "DELETE" }), ctx(clientA.id));
    expect(res.status).toBe(409);
    expect(rows("client")).toHaveLength(1);
    expect(rows("facture")).toHaveLength(1);
  });

  it("client sans facture ni avoir : supprimable", async () => {
    as(userA);
    expect((await deleteClient(new Request("http://localhost/x", { method: "DELETE" }), ctx(clientA.id))).status).toBe(200);
    expect(rows("client")).toHaveLength(0);
  });
});

describe("devis — interface web, duplication et WhatsApp sur une même série", () => {
  it("préfixe personnalisé : web, WhatsApp et duplication se suivent ; le paramètre avance", async () => {
    seed("settings", { userId: userA.id, prefixeDevis: "DV-", prochainNumeroDevis: 10 });
    as(userA);

    const web = await (await createDevisWeb(post({ clientId: clientA.id, lines: [LINE] }))).json();

    const conv = seed("whatsappConversation", { userId: userA.id, phoneNumber: "+33611111111", state: "awaiting_creation_confirmation" });
    const pending: PendingDevis = {
      ...emptyPendingDevis(),
      objet: { value: "Peinture", source: "artisan" },
      client: { ...emptyPendingDevis().client, nomMentionne: "Client fictif A", matchedClientId: clientA.id, matchStatus: "unique_match" },
      lignes: [{
        description: "Peinture", quantite: { value: 1, source: "artisan" }, unite: { value: null, source: "manquant" },
        prixUnitaire: { value: 300, source: "artisan" }, montant: { value: 300, source: "gestly" }, tva: { value: 20, source: "gestly" },
      }],
      state: "awaiting_creation_confirmation",
    };
    const whatsapp = await confirmDevisCreation(conv.id, userA.id, pending);

    const dup = await (await duplicateDevis(post({}), ctx(web.id))).json();

    expect([web.number, whatsapp.kind === "created" ? whatsapp.number : null, dup.number]).toEqual(["DV-010", "DV-011", "DV-012"]);
    expect(rows("settings")[0].prochainNumeroDevis).toBe(13);
  });

  it("série historique : la suppression d'un devis intermédiaire ne fait rejouer aucun numéro", async () => {
    as(userA);
    const created: Record<string, any>[] = [];
    for (let i = 0; i < 3; i++) created.push(await (await createDevisWeb(post({ clientId: clientA.id, lines: [LINE] }))).json());
    fakePrisma.store.devis = fakePrisma.store.devis.filter((d) => d.id !== created[1].id);
    expect((await (await createDevisWeb(post({ clientId: clientA.id, lines: [LINE] }))).json()).number).toBe(num("DEV", 4));
  });
});
