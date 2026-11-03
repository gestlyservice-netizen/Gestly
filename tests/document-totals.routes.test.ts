import { describe, it, expect, vi, beforeEach } from "vitest";
import { defaultDueDateIso } from "@/lib/factures/echeance";

// Recette V1, blocs 4 et 5 : les montants enregistrés par les routes de
// création et de modification sont ceux du calcul partagé
// (lib/documents/totals.ts), et une requête forgée est refusée.

const created: Record<string, unknown>[] = [];
const db = {
  client: { findFirst: vi.fn(async () => ({ id: "c1", userId: "user_a" })) },
  devis: {
    findFirst: vi.fn(async () => ({ id: "d1", userId: "user_a", status: "brouillon", client: {}, lines: [] })),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args.data); return { id: "d1", ...args.data }; }),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args.data); return { id: "d1", ...args.data }; }),
  },
  facture: {
    create: vi.fn(async (args: { data: Record<string, unknown> }) => { created.push(args.data); return { id: "f1", ...args.data }; }),
    findFirst: vi.fn(async () => null),
  },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
};

vi.mock("@/lib/prisma", () => ({ prisma: db, default: db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => ({ id: "user_a", stripeSubscriptionId: "sub_a", subscriptionStatus: "active" }),
}));
vi.mock("@/lib/numbering/document-number", () => ({
  allocateDocumentNumber: async (_tx: unknown, type: string) => ({ number: type === "devis" ? "DEV-2026-001" : "FAC-2026-001", issuedAt: new Date("2026-10-27") }),
}));
vi.mock("@/lib/devis/lifecycle", () => ({
  isDevisInvoiced: async () => false,
  modificationRefusal: () => null,
  deletionRefusal: () => null,
  statusChangeRefusal: () => null,
}));

const post = (body: unknown) =>
  new Request("http://localhost:3000/api/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = (body: unknown) =>
  new Request("http://localhost:3000/api/x", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const decimalLines = [
  { description: "Fourniture", quantity: 3, unitPriceHT: 0.1, tvaRate: 20 },
  { description: "Pose", quantity: 1.5, unitPriceHT: 33.33, tvaRate: 10 },
];
// 0,30 + 50,00 (49,995) = 50,30 HT ; TVA 0,06 + 5,00 = 5,06 ; TTC 55,36
const expected = { totalHT: 50.3, totalTVA: 5.06, totalTTC: 55.36 };
const DUE = defaultDueDateIso(); // échéance obligatoire des nouvelles factures

beforeEach(() => { created.length = 0; vi.clearAllMocks(); });

describe("POST /api/factures", () => {
  it("[régression] totaux au centime (avant : 0,30000000000000004 et TVA non arrondie)", async () => {
    const { POST } = await import("@/app/api/factures/route");
    const res = await POST(post({ clientId: "c1", dueDate: DUE, lines: decimalLines }));
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject(expected);
  });

  it("[régression] taux de TVA absent : 20 % (avant : NaN enregistré)", async () => {
    const { POST } = await import("@/app/api/factures/route");
    const res = await POST(post({ clientId: "c1", dueDate: DUE, lines: [{ description: "Pose", quantity: 2, unitPriceHT: 50 }] }));
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject({ totalHT: 100, totalTVA: 20, totalTTC: 120 });
  });

  it.each([
    [[{ description: "x", quantity: -1, unitPriceHT: 10, tvaRate: 20 }], "Ligne 1 : quantité invalide"],
    [[{ description: "x", quantity: 1, unitPriceHT: -10, tvaRate: 20 }], "Ligne 1 : prix unitaire invalide"],
    [[{ description: "", quantity: 1, unitPriceHT: 10, tvaRate: 20 }], "Ligne 1 : description requise"],
    [[{ description: "x", quantity: 1, unitPriceHT: 10, tvaRate: 200 }], "Ligne 1 : taux de TVA invalide"],
  ])("ligne forgée refusée (400), aucune facture ni numéro : %j", async (lines, error) => {
    const { POST } = await import("@/app/api/factures/route");
    const res = await POST(post({ clientId: "c1", dueDate: DUE, lines }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(db.facture.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("date d'échéance invalide : 400 (avant : 500)", async () => {
    const { POST } = await import("@/app/api/factures/route");
    const res = await POST(post({ clientId: "c1", dueDate: "pas-une-date", lines: decimalLines }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/devis", () => {
  it("[régression] totaux au centime", async () => {
    const { POST } = await import("@/app/api/devis/route");
    const res = await POST(post({ clientId: "c1", lines: decimalLines, status: "brouillon" }));
    expect(res.status).toBe(201);
    expect(created[0]).toMatchObject(expected);
  });

  it.each(["signe", "facture", "paye", "n'importe quoi"])(
    "[régression] statut de création « %s » refusé (seuls brouillon et envoyé)",
    async (status) => {
      const { POST } = await import("@/app/api/devis/route");
      const res = await POST(post({ clientId: "c1", lines: decimalLines, status }));
      expect(res.status).toBe(400);
      expect(db.devis.create).not.toHaveBeenCalled();
    }
  );

  it("ligne invalide : 400 avec le message de la ligne", async () => {
    const { POST } = await import("@/app/api/devis/route");
    const res = await POST(post({ clientId: "c1", lines: [{ description: "x", quantity: 0, unitPriceHT: 1, tvaRate: 20 }] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Ligne 1 : quantité invalide" });
  });
});

describe("PUT /api/devis/[id]", () => {
  it("[régression] modification : totaux au centime", async () => {
    const { PUT } = await import("@/app/api/devis/[id]/route");
    const res = await PUT(put({ clientId: "c1", validityDays: 30, lines: decimalLines }), { params: { id: "d1" } });
    expect(res.status).toBe(200);
    expect(created[0]).toMatchObject(expected);
  });

  it("ligne invalide : 400, devis inchangé", async () => {
    const { PUT } = await import("@/app/api/devis/[id]/route");
    const res = await PUT(put({ clientId: "c1", lines: [{ description: "x", quantity: 1, unitPriceHT: "abc", tvaRate: 20 }] }), { params: { id: "d1" } });
    expect(res.status).toBe(400);
    expect(db.devis.update).not.toHaveBeenCalled();
  });
});
