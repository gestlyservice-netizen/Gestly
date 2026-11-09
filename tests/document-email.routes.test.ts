import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// Recette M15 : envoi des devis et factures par email.
// Routes réelles (app/api/devis/[id]/send, app/api/factures/[id]/send), PDF
// RÉELLEMENT généré (jsPDF), base simulée en mémoire, SDK Resend simulé.
// Tout appel fetch fait échouer le test : aucun accès réseau possible.
// Vérifie montants, destinataires, pièces jointes, erreurs Resend, échappement
// HTML, validation des adresses, limitation de débit et mode simulation.

const mocks = vi.hoisted(() => {
  const resendSend = vi.fn();
  return { resendSend, Resend: vi.fn(() => ({ emails: { send: resendSend } })) };
});
vi.mock("resend", () => ({ Resend: mocks.Resend }));

const settings = {
  companyName: "Artisan Fictif", formeJuridique: "EI", siret: "000 000 000 00011",
  tvaIntracom: null, adresseRue: "2 rue de l'Essai", codePostal: "75002", ville: "Paris",
  telephone: null, emailPro: "artisan.test@example.com", couleurPrincipale: "#2563EB", piedDePage: null,
  penalitesRetard: null, conditionsPaiement: null, reservePropriete: false,
};
// Devis de la recette M4 : 3 × 0,10 € à 20 % ; 1,5 × 33,33 € à 10 % → 50,30 / 5,06 / 55,36.
const lines = [
  { description: "Prestation A", quantity: 3, unitPriceHT: 0.1, tvaRate: 20, totalHT: 0.3 },
  { description: "Prestation B", quantity: 1.5, unitPriceHT: 33.33, tvaRate: 10, totalHT: 50 },
];
const amounts = { totalHT: 50.3, totalTVA: 5.06, totalTTC: 55.36 };
const client = (over: Record<string, unknown> = {}) => ({
  name: "Client Fictif", email: "client.test@example.com", phone: null, address: "1 rue de l'Exemple", ...over,
});
const makeDevis = (over: Record<string, unknown> = {}) => ({
  id: "dev_a", userId: "user_a", number: "DEV-2026-001", status: "brouillon", sentAt: null,
  createdAt: new Date("2026-11-03T10:00:00Z"), validityDays: 30, notes: null,
  ...amounts, client: client(), lines, ...over,
});
const makeFacture = (over: Record<string, unknown> = {}) => ({
  id: "fac_a", userId: "user_a", number: "FAC-2026-001", sentAt: null,
  createdAt: new Date("2026-11-03T10:00:00Z"), dueDate: new Date("2026-12-03T10:00:00Z"), notes: null,
  ...amounts, client: client(), lines, devis: null, ...over,
});

const state = vi.hoisted(() => ({ devis: null as unknown, facture: null as unknown }));
const db = vi.hoisted(() => ({
  devis: { findFirst: vi.fn(), update: vi.fn() },
  facture: { findFirst: vi.fn(), update: vi.fn() },
  settings: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db, default: db }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getCurrentUser: async () => ({
    id: "user_a", companyName: "Artisan Fictif", stripeSubscriptionId: "sub_a", subscriptionStatus: "trialing",
  }),
}));

import { POST as sendDevis } from "@/app/api/devis/[id]/send/route";
import { POST as sendFacture } from "@/app/api/factures/[id]/send/route";
import { clearSimulatedOutbox, getSimulatedOutbox } from "@/lib/outbound/mode";
import { clearRateLimits } from "@/lib/rate-limit";
import { DOCUMENT_EMAIL_LIMITS } from "@/lib/documents/document-email";

const ENV_KEYS = ["OUTBOUND_MODE", "VERCEL_ENV", "RESEND_API_KEY", "RESEND_FROM_EMAIL"];
let savedEnv: Record<string, string | undefined> = {};
let fetchSpy: MockInstance<typeof fetch>;

const RESEND_OK = { data: { id: "re_123" }, error: null, headers: null };
const RESEND_REFUSED = {
  data: null, error: { name: "validation_error", message: "The gestly.fr domain is not verified" }, headers: null,
};

function live() {
  process.env.OUTBOUND_MODE = "live";
  process.env.RESEND_API_KEY = "re_fake_for_tests";
}

type SentPayload = {
  from: string; to: string; subject: string; html?: string; text: string; replyTo?: string;
  attachments: { filename: string; content: Buffer }[];
};
const sentPayload = (i = 0) => mocks.resendSend.mock.calls[i][0] as SentPayload;
const pdfText = (b: Buffer) => b.toString("latin1");
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const reqDevis = () => new Request("http://localhost/api/devis/dev_a/send", { method: "POST" });
const reqFacture = (body?: unknown) =>
  new Request("http://localhost/api/factures/fac_a/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
  clearSimulatedOutbox();
  clearRateLimits();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("APPEL RÉSEAU INTERDIT dans les tests");
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  state.devis = makeDevis();
  state.facture = makeFacture();
  // Filtre par compte : un autre identifiant ou un autre compte ne trouve rien.
  db.devis.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === "dev_a" && where.userId === "user_a" ? state.devis : null);
  db.facture.findFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) =>
    where.id === "fac_a" && where.userId === "user_a" ? state.facture : null);
  db.devis.update.mockImplementation(async ({ data }: { data: object }) => ({ ...(state.devis as object), ...data }));
  db.facture.update.mockImplementation(async ({ data }: { data: object }) => ({ ...(state.facture as object), ...data }));
  db.settings.findUnique.mockResolvedValue(settings);
  mocks.resendSend.mockResolvedValue(RESEND_OK);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/devis/[id]/send", () => {
  it("simulation (OUTBOUND_MODE=simulate) : aucun client Resend créé, aucun appel réseau, envoi journalisé avec PDF", async () => {
    process.env.OUTBOUND_MODE = "simulate";
    process.env.RESEND_API_KEY = "re_fake_for_tests"; // une vraie clé présente ne change rien

    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });

    expect(res.status).toBe(200);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(mocks.resendSend).not.toHaveBeenCalled();
    const outbox = getSimulatedOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ channel: "email", to: "cl***@example.com" });
    expect(outbox[0].summary).toBe('subject="Devis DEV-2026-001 — Artisan Fictif" attachments=1');
    expect((await res.json()).status).toBe("envoye");
  });

  it("succès : destinataire, expéditeur, réponse, objet, montants, PDF réel joint ; devis marqué envoyé", async () => {
    live();
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });

    expect(res.status).toBe(200);
    expect(mocks.Resend).toHaveBeenCalledTimes(1);
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);
    const p = sentPayload();
    expect(p.to).toBe("client.test@example.com");
    expect(p.from).toBe("Gestly <onboarding@resend.dev>");
    expect(p.replyTo).toBe("artisan.test@example.com");
    expect(p.subject).toBe("Devis DEV-2026-001 — Artisan Fictif");
    for (const out of [visible(p.html!), p.text]) {
      expect(out).toContain("50,30 €");
      expect(out).toContain("5,06 €");
      expect(out).toContain("55,36 €");
      expect(out).toContain("03/12/2026");
    }
    expect(p.html).toMatch(/href="https?:\/\/[^"]+\/print\/devis\/dev_a"/);

    // Pièce jointe : un seul PDF, réellement généré, aux montants de la recette.
    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].filename).toBe("devis-DEV-2026-001.pdf");
    expect(Buffer.isBuffer(p.attachments[0].content)).toBe(true);
    const pdf = pdfText(p.attachments[0].content);
    expect(pdf).toMatch(/^%PDF-1\.\d/);
    for (const s of ["DEVIS", "DEV-2026-001", "Artisan Fictif", "Client Fictif", "Prestation B", "(1,5)", "(50,30 ", "(5,06 ", "(55,36 "]) {
      expect(pdf).toContain(s);
    }

    expect(db.devis.update).toHaveBeenCalledTimes(1);
    const update = db.devis.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "dev_a" });
    expect(update.data.status).toBe("envoye");
    expect(update.data.sentAt).toBeInstanceOf(Date);
    expect(db.devis.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dev_a", userId: "user_a" } }));
  });

  it("expéditeur configuré (RESEND_FROM_EMAIL) utilisé ; sans email pro valide, pas d'adresse de réponse", async () => {
    live();
    process.env.RESEND_FROM_EMAIL = "Gestly <devis@example.com>";
    db.settings.findUnique.mockResolvedValue({ ...settings, emailPro: "pas-une-adresse" });
    await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(sentPayload().from).toBe("Gestly <devis@example.com>");
    expect(sentPayload()).not.toHaveProperty("replyTo");
  });

  it("refus de Resend ({ error }) : 500, devis NON marqué envoyé", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Échec de l'envoi de l'email");
    expect(db.devis.update).not.toHaveBeenCalled();
  });

  it("erreur réseau du SDK Resend : 500, devis NON marqué envoyé", async () => {
    live();
    mocks.resendSend.mockRejectedValue(new Error("ECONNRESET"));
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(500);
    expect(db.devis.update).not.toHaveBeenCalled();
  });

  it("Resend sans identifiant d'email : 500, devis NON marqué envoyé", async () => {
    live();
    mocks.resendSend.mockResolvedValue({ data: null, error: null, headers: null });
    expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(500);
    expect(db.devis.update).not.toHaveBeenCalled();
  });

  it.each([
    ["sans email", null, "Ce client n'a pas d'adresse email"],
    ["email vide", "  ", "Ce client n'a pas d'adresse email"],
    ["deux adresses", "a@example.com, b@example.com", "L'adresse email de ce client est invalide : corrigez-la dans sa fiche"],
    ["injection d'en-tête", "a@example.com\r\nBcc: b@example.com", "L'adresse email de ce client est invalide : corrigez-la dans sa fiche"],
    ["adresse mal formée", "client@example", "L'adresse email de ce client est invalide : corrigez-la dans sa fiche"],
  ])("client %s : 400, aucun envoi", async (_label, email, message) => {
    live();
    state.devis = makeDevis({ client: client({ email }) });
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(message);
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(db.devis.update).not.toHaveBeenCalled();
  });

  it("adresse du client avec espaces de bord : nettoyée avant envoi", async () => {
    live();
    state.devis = makeDevis({ client: client({ email: "  client.test@example.com " }) });
    expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(200);
    expect(sentPayload().to).toBe("client.test@example.com");
  });

  it("devis d'un autre compte ou inexistant : 404, aucun envoi", async () => {
    live();
    const res = await sendDevis(reqDevis(), { params: { id: "dev_b" } });
    expect(res.status).toBe(404);
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("[sécurité] données saisies échappées dans le HTML envoyé ; PDF et texte inchangés", async () => {
    live();
    state.devis = makeDevis({
      notes: `<img src=x onerror=alert(1)>`,
      client: client({ name: `<script>alert("x")</script>` }),
      lines: [{ ...lines[0], description: `<a href="https://pirate.example">Cliquez</a>` }, lines[1]],
    });
    expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(200);
    const { html } = sentPayload();
    expect(html).not.toMatch(/<script|<img|pirate\.example">/i);
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;a href=&quot;https://pirate.example&quot;&gt;Cliquez&lt;/a&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("devis déjà signé : statut et date du premier envoi conservés", async () => {
    live();
    const firstSent = new Date("2026-11-04T09:00:00Z");
    state.devis = makeDevis({ status: "signe", sentAt: firstSent });
    await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(db.devis.update.mock.calls[0][0].data).toEqual({ status: "signe", sentAt: firstSent });
  });

  it(`limitation : ${DOCUMENT_EMAIL_LIMITS.perDocument.limit} envois du même devis puis 429, sans appel à Resend`, async () => {
    live();
    const { limit } = DOCUMENT_EMAIL_LIMITS.perDocument;
    for (let i = 0; i < limit; i++) {
      expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(200);
    }
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/Trop d'envois/);
    expect(mocks.resendSend).toHaveBeenCalledTimes(limit);
    expect(db.devis.update).toHaveBeenCalledTimes(limit);
  });

  it("requête refusée (adresse invalide) : ne consomme pas le quota d'envoi", async () => {
    live();
    state.devis = makeDevis({ client: client({ email: "invalide" }) });
    for (let i = 0; i < 5; i++) await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    state.devis = makeDevis();
    expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(200);
  });

  it("email parti mais enregistrement en échec : 500 explicite (ne pas renvoyer)", async () => {
    live();
    db.devis.update.mockRejectedValue(new Error("base indisponible"));
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/a été envoyé, mais son enregistrement a échoué/);
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);
  });

  it("bêta privée (OUTBOUND_MODE=simulate en production) : 503, ni envoi ni simulation", async () => {
    process.env.OUTBOUND_MODE = "simulate";
    process.env.VERCEL_ENV = "production";
    const res = await sendDevis(reqDevis(), { params: { id: "dev_a" } });
    expect(res.status).toBe(503);
    expect(getSimulatedOutbox()).toHaveLength(0);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(db.devis.update).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/factures/[id]/send", () => {
  it("simulation (OUTBOUND_MODE=simulate) : aucun client Resend créé, aucun appel réseau, envoi journalisé avec PDF", async () => {
    process.env.OUTBOUND_MODE = "simulate";
    process.env.RESEND_API_KEY = "re_fake_for_tests";
    const res = await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(res.status).toBe(200);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(getSimulatedOutbox()).toHaveLength(1);
    expect(getSimulatedOutbox()[0].summary).toBe('subject="Facture FAC-2026-001 — Artisan Fictif" attachments=1');
    expect(db.facture.update).toHaveBeenCalledTimes(1);
  });

  it("succès par défaut : client destinataire, objet et message par défaut, PDF réel joint ; facture marquée envoyée", async () => {
    live();
    const res = await sendFacture(reqFacture(), { params: { id: "fac_a" } });

    expect(res.status).toBe(200);
    const p = sentPayload();
    expect(p.to).toBe("client.test@example.com");
    expect(p.from).toBe("Gestly <onboarding@resend.dev>");
    expect(p.replyTo).toBe("artisan.test@example.com");
    expect(p.subject).toBe("Facture FAC-2026-001 — Artisan Fictif");
    expect(p.text).toBe(
      "Bonjour Client Fictif,\n\nVeuillez trouver ci-joint votre facture FAC-2026-001 d'un montant de 55,36 € TTC.\n\nCordialement,\nArtisan Fictif"
    );
    expect(p).not.toHaveProperty("html");

    expect(p.attachments).toHaveLength(1);
    expect(p.attachments[0].filename).toBe("facture-FAC-2026-001.pdf");
    const pdf = pdfText(p.attachments[0].content);
    expect(pdf).toMatch(/^%PDF-1\.\d/);
    for (const s of ["FACTURE", "FAC-2026-001", "000 000 000 00011", "03/12/2026", "(50,30 ", "(5,06 ", "(55,36 ", "40 euros"]) {
      expect(pdf).toContain(s);
    }

    const update = db.facture.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: "fac_a" });
    expect(update.data.sentAt).toBeInstanceOf(Date);
    expect(db.facture.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "fac_a", userId: "user_a" } }));
  });

  it("destinataire, objet et message saisis : utilisés (objet ramené sur une ligne)", async () => {
    live();
    const res = await sendFacture(
      reqFacture({ to: " compta.test@example.com ", subject: "Votre facture\r\nde novembre", message: "Bonjour,\n\nCi-joint.\n" }),
      { params: { id: "fac_a" } }
    );
    expect(res.status).toBe(200);
    const p = sentPayload();
    expect(p.to).toBe("compta.test@example.com");
    expect(p.subject).toBe("Votre facture de novembre");
    expect(p.text).toBe("Bonjour,\n\nCi-joint.");
    expect(p.attachments[0].filename).toBe("facture-FAC-2026-001.pdf");
  });

  it.each([
    ["mal formé", "compta@"],
    ["plusieurs adresses", "a@example.com; b@example.com"],
    ["nom affiché", "Compta <compta@example.com>"],
    ["injection d'en-tête", "a@example.com\nBcc: b@example.com"],
  ])("destinataire saisi %s : 400, aucun envoi, facture inchangée", async (_label, to) => {
    live();
    const res = await sendFacture(reqFacture({ to }), { params: { id: "fac_a" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Adresse email du destinataire invalide/);
    expect(mocks.resendSend).not.toHaveBeenCalled();
    expect(db.facture.update).not.toHaveBeenCalled();
  });

  it("objet trop long ou champ d'un type inattendu : 400, aucun envoi", async () => {
    live();
    expect((await sendFacture(reqFacture({ subject: "x".repeat(201) }), { params: { id: "fac_a" } })).status).toBe(400);
    expect((await sendFacture(reqFacture({ to: ["a@example.com"] }), { params: { id: "fac_a" } })).status).toBe(400);
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("client sans email : 400 sans destinataire saisi, envoi possible avec un destinataire saisi", async () => {
    live();
    state.facture = makeFacture({ client: client({ email: null }) });
    const refused = await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("Ce client n'a pas d'adresse email — renseignez un destinataire");
    expect(mocks.resendSend).not.toHaveBeenCalled();

    const ok = await sendFacture(reqFacture({ to: "compta.test@example.com" }), { params: { id: "fac_a" } });
    expect(ok.status).toBe(200);
    expect(sentPayload().to).toBe("compta.test@example.com");
  });

  it("email du client invalide et aucun destinataire saisi : 400", async () => {
    live();
    state.facture = makeFacture({ client: client({ email: "a@example.com,b@example.com" }) });
    const res = await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/adresse email de ce client est invalide/);
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("refus de Resend ({ error }) : 500, facture NON marquée envoyée", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const res = await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Échec de l'envoi de l'email");
    expect(db.facture.update).not.toHaveBeenCalled();
  });

  it("erreur réseau du SDK Resend : 500, facture NON marquée envoyée", async () => {
    live();
    mocks.resendSend.mockRejectedValue(new Error("ETIMEDOUT"));
    expect((await sendFacture(reqFacture({}), { params: { id: "fac_a" } })).status).toBe(500);
    expect(db.facture.update).not.toHaveBeenCalled();
  });

  it("facture d'un autre compte : 404, aucun envoi", async () => {
    live();
    const res = await sendFacture(reqFacture({ to: "compta.test@example.com" }), { params: { id: "fac_b" } });
    expect(res.status).toBe(404);
    expect(mocks.resendSend).not.toHaveBeenCalled();
  });

  it("facture sans lignes propres (ancienne facture issue d'un devis) : PDF avec les lignes du devis", async () => {
    live();
    state.facture = makeFacture({
      lines: [],
      devis: { lines: [{ description: "Ligne du devis", quantity: 1, unitPriceHT: 50.3, tvaRate: 10, totalHT: 50.3 }] },
    });
    await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(pdfText(sentPayload().attachments[0].content)).toContain("Ligne du devis");
  });

  it(`limitation : ${DOCUMENT_EMAIL_LIMITS.perDocument.limit} envois de la même facture puis 429 ; un autre document reste possible`, async () => {
    live();
    const { limit } = DOCUMENT_EMAIL_LIMITS.perDocument;
    for (let i = 0; i < limit; i++) {
      expect((await sendFacture(reqFacture({}), { params: { id: "fac_a" } })).status).toBe(200);
    }
    expect((await sendFacture(reqFacture({}), { params: { id: "fac_a" } })).status).toBe(429);
    expect(mocks.resendSend).toHaveBeenCalledTimes(limit);
    expect((await sendDevis(reqDevis(), { params: { id: "dev_a" } })).status).toBe(200);
  });

  it(`limitation par compte : ${DOCUMENT_EMAIL_LIMITS.perAccount.limit} envois par heure tous documents confondus`, async () => {
    process.env.OUTBOUND_MODE = "simulate";
    const { limit } = DOCUMENT_EMAIL_LIMITS.perAccount;
    db.facture.findFirst.mockImplementation(async ({ where }: { where: { id: string } }) =>
      makeFacture({ id: where.id }));
    for (let i = 0; i < limit; i++) {
      expect((await sendFacture(reqFacture({}), { params: { id: `fac_${i}` } })).status).toBe(200);
    }
    expect((await sendFacture(reqFacture({}), { params: { id: "fac_suivante" } })).status).toBe(429);
    expect(getSimulatedOutbox()).toHaveLength(limit);
  });

  it("bêta privée (OUTBOUND_MODE=simulate en production) : 503, ni envoi ni simulation", async () => {
    process.env.OUTBOUND_MODE = "simulate";
    process.env.VERCEL_ENV = "production";
    const res = await sendFacture(reqFacture({}), { params: { id: "fac_a" } });
    expect(res.status).toBe(503);
    expect(getSimulatedOutbox()).toHaveLength(0);
    expect(db.facture.update).not.toHaveBeenCalled();
  });
});
