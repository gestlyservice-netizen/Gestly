import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Recette V1, M4 et M6 : le bouton « PDF » du dashboard télécharge réellement
// le devis / la facture.
// Anomalie corrigée : le bouton ouvrait /print/…?download=1, qui capturait la
// page avec html2canvas puis appelait window.close() juste après pdf.save() ;
// Chrome détruisait la fenêtre avant de démarrer le téléchargement (fenêtre
// qui « charge puis se referme », aucun fichier). Reproduit dans Chrome :
// aucun téléchargement ; même page sans window.close() : PDF de 204 Ko.
// Les PDF sont désormais servis en pièce jointe par une route serveur (même
// moteur que les emails et WhatsApp). Génération RÉELLE ici (jsPDF, aucun mock).

const settings = {
  companyName: "Artisan Fictif", formeJuridique: "EI", siret: "000 000 000 00011",
  tvaIntracom: null, adresseRue: "2 rue de l'Essai", codePostal: "75002", ville: "Paris",
  telephone: null, emailPro: null, couleurPrincipale: "#2563EB", piedDePage: null,
  penalitesRetard: null, conditionsPaiement: null, reservePropriete: false,
};
const client = { name: "Client Fictif", email: "client.test@example.com", phone: null, address: "1 rue de l'Exemple" };
// Devis de la recette M4 : 3 × 0,10 € à 20 % ; 1,5 × 33,33 € à 10 %.
const lines = [
  { description: "Prestation A", quantity: 3, unitPriceHT: 0.1, tvaRate: 20, totalHT: 0.3 },
  { description: "Prestation B", quantity: 1.5, unitPriceHT: 33.33, tvaRate: 10, totalHT: 50 },
];
const amounts = { totalHT: 50.3, totalTVA: 5.06, totalTTC: 55.36 };
const devis = {
  id: "dev_a", userId: "user_a", number: "DEV-2026-001", createdAt: new Date("2026-11-03T10:00:00Z"),
  validityDays: 30, notes: null, ...amounts, client, lines,
};
const facture = {
  id: "fac_a", userId: "user_a", number: "FAC-2026-001", createdAt: new Date("2026-11-03T10:00:00Z"),
  dueDate: new Date("2026-12-03T10:00:00Z"), notes: null, ...amounts, client, lines, devis: null,
};

const db = {
  devis: { findFirst: vi.fn() },
  facture: { findFirst: vi.fn() },
  settings: { findUnique: vi.fn(async () => settings) },
};
vi.mock("@/lib/prisma", () => ({ prisma: db, default: db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => ({ id: "user_a", stripeSubscriptionId: "sub_a", subscriptionStatus: "trialing" }),
}));

const req = () => new Request("http://localhost:3000/api/x");
const pdfText = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString("latin1");

beforeEach(() => {
  vi.clearAllMocks();
  // Filtre par compte : un autre identifiant ou un autre compte ne trouve rien.
  db.devis.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === devis.id && where.userId === "user_a" ? devis : null);
  db.facture.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === facture.id && where.userId === "user_a" ? facture : null);
});

describe("GET /api/devis/[id]/pdf", () => {
  it("[régression] renvoie un vrai fichier PDF en pièce jointe (téléchargement direct)", async () => {
    const { GET } = await import("@/app/api/devis/[id]/pdf/route");
    const res = await GET(req(), { params: { id: "dev_a" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="devis-DEV-2026-001.pdf"');
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = await pdfText(res);
    expect(text).toMatch(/^%PDF-1\.\d/);
    expect(text.trimEnd()).toMatch(/%%EOF$/);
    // Le PDF généré peut être inspecté à la main (copie locale, hors dépôt).
    if (process.env.PDF_DUMP_DIR) writeFileSync(join(process.env.PDF_DUMP_DIR, "devis-DEV-2026-001.pdf"), Buffer.from(text, "latin1"));
  });

  it("contient le numéro, l'entreprise, le SIRET, les lignes, les montants de la recette et les mentions", async () => {
    const { GET } = await import("@/app/api/devis/[id]/pdf/route");
    const text = await pdfText(await GET(req(), { params: { id: "dev_a" } }));

    for (const s of ["DEVIS", "DEV-2026-001", "Artisan Fictif", "000 000 000 00011", "Client Fictif", "Prestation A", "Prestation B"]) {
      expect(text).toContain(s);
    }
    expect(text).toContain("(1,5)"); // quantité au format français (avant : « 1.5 »)
    expect(text).toContain("(50,30 ");
    expect(text).toContain("(5,06 ");
    expect(text).toContain("(55,36 ");
    expect(text).toContain("Devis valable 30 jours");
    expect(db.devis.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dev_a", userId: "user_a" } }));
  });

  it("devis d'un autre compte ou inexistant : 404, aucun PDF", async () => {
    const { GET } = await import("@/app/api/devis/[id]/pdf/route");
    const res = await GET(req(), { params: { id: "dev_b" } });
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toBe("application/pdf");
  });
});

describe("GET /api/factures/[id]/pdf", () => {
  it("[régression] PDF en pièce jointe, avec échéance, pénalités et indemnité de 40 €", async () => {
    const { GET } = await import("@/app/api/factures/[id]/pdf/route");
    const res = await GET(req(), { params: { id: "fac_a" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="facture-FAC-2026-001.pdf"');
    const text = await pdfText(res);
    expect(text).toMatch(/^%PDF-1\.\d/);
    for (const s of ["FACTURE", "FAC-2026-001", "000 000 000 00011", "03/12/2026", "(55,36 ", "40 euros", "escompte"]) {
      expect(text).toContain(s);
    }
    if (process.env.PDF_DUMP_DIR) writeFileSync(join(process.env.PDF_DUMP_DIR, "facture-FAC-2026-001.pdf"), Buffer.from(text, "latin1"));
  });

  it("facture d'un autre compte : 404", async () => {
    const { GET } = await import("@/app/api/factures/[id]/pdf/route");
    expect((await GET(req(), { params: { id: "fac_b" } })).status).toBe(404);
  });
});

describe("[régression] boutons PDF du dashboard", () => {
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("pointent vers les routes de téléchargement, sans popup", () => {
    expect(src("app/dashboard/devis/[id]/page.tsx")).toContain("/api/devis/${devis.id}/pdf");
    expect(src("app/dashboard/devis/page.tsx")).toContain("/api/devis/${d.id}/pdf");
    expect(src("app/dashboard/factures/[id]/page.tsx")).toContain("/api/factures/${facture.id}/pdf");
    for (const p of ["app/dashboard/devis/[id]/page.tsx", "app/dashboard/devis/page.tsx", "app/dashboard/factures/[id]/page.tsx"]) {
      expect(src(p)).not.toContain("download=1");
    }
  });

  it("les pages d'impression ne génèrent plus de PDF ni ne se referment seules", () => {
    for (const p of ["app/print/devis/[id]/page.tsx", "app/print/factures/[id]/page.tsx"]) {
      const s = src(p);
      expect(s).not.toContain("pdf.save(");
      expect(s).not.toContain("html2canvas");
    }
  });
});
