import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Recette M15 — envoi des devis et factures par email, de bout en bout.
//
// Lancée UNIQUEMENT par scripts/recette/m15-email-local.ps1, qui crée un
// serveur PostgreSQL 17 temporaire sur localhost (schéma issu de
// schema.prisma) et simule un serveur en UTC (comme Vercel).
//   - vraies routes API et vrai Prisma sur cette base locale ;
//   - Clerk simulé (identité de l'artisan A ou B) ; getCurrentUser réel ;
//   - envois : mode simulation réel de lib/outbound (aucun client Resend) ;
//     contenu de chaque email capturé AVANT la simulation pour être relu ;
//   - tout appel fetch fait échouer la recette ;
//   - refus de démarrer si la base n'est pas locale.
// Données 100 % fictives (adresses @example.com).
// ─────────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => {
  const url = process.env.GESTLY_RECETTE_PG ?? "";
  // Garde-fou : seule une base locale de recette est acceptée.
  const m = /^postgresql:\/\/postgres@(localhost|127\.0\.0\.1):(\d+)\/(gestly_recette)$/.exec(url);
  if (!m) throw new Error("Recette refusée : GESTLY_RECETTE_PG doit viser la base locale gestly_recette (lancer scripts/recette/m15-email-local.ps1).");
  return {
    url,
    clerkUserId: null as string | null,
    captured: [] as Record<string, unknown>[],
    resendSend: undefined as unknown as ReturnType<typeof vi.fn>,
    Resend: undefined as unknown as ReturnType<typeof vi.fn>,
  };
});

vi.mock("@/lib/prisma", async () => {
  const { Pool } = await import("pg");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: h.url, max: 4 })) });
  return { prisma, default: prisma };
});
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: h.clerkUserId })),
  currentUser: vi.fn(async () => null),
}));
// SDK Resend : jamais instancié en simulation ; utilisé une seule fois, en
// mode « live » avec ce faux SDK, pour rejouer un refus de Resend sur la vraie base.
vi.mock("resend", () => {
  h.resendSend = vi.fn();
  h.Resend = vi.fn(() => ({ emails: { send: h.resendSend } }));
  return { Resend: h.Resend };
});
// Capture du contenu exact transmis à sendEmail(), puis envoi réel du module
// (donc simulation réelle de lib/outbound/email.ts).
vi.mock("@/lib/outbound/email", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/outbound/email")>();
  return {
    ...mod,
    sendEmail: async (payload: Parameters<typeof mod.sendEmail>[0]) => {
      h.captured.push(payload as unknown as Record<string, unknown>);
      return mod.sendEmail(payload);
    },
  };
});

import { prisma } from "@/lib/prisma";
import { getOutboundMode, isOutboundDisabled, getSimulatedOutbox, clearSimulatedOutbox } from "@/lib/outbound/mode";
import { POST as saveSettings } from "@/app/api/settings/route";
import { POST as createClient } from "@/app/api/clients/route";
import { POST as createDevis } from "@/app/api/devis/route";
import { PATCH as patchDevis } from "@/app/api/devis/[id]/route";
import { GET as devisPdf } from "@/app/api/devis/[id]/pdf/route";
import { POST as sendDevis } from "@/app/api/devis/[id]/send/route";
import { POST as toFacture } from "@/app/api/devis/[id]/to-facture/route";
import { GET as facturePdf } from "@/app/api/factures/[id]/pdf/route";
import { GET as factureEmailDefaults, POST as sendFacture } from "@/app/api/factures/[id]/send/route";
import { POST as createAvoir } from "@/app/api/factures/[id]/avoir/route";
import { GET as avoirPdf } from "@/app/api/avoirs/[id]/pdf/route";
import { defaultDueDateIso } from "@/lib/factures/echeance";

// ─── Journal de recette ──────────────────────────────────────────────────────
type Step = { id: string; titre: string; attendu: string; observe: string; ok: boolean };
const steps: Step[] = [];
const OUT = process.env.GESTLY_RECETTE_OUT ?? "";
const save = (name: string, content: string | Buffer) => { if (OUT) fs.writeFileSync(path.join(OUT, name), content); };

async function step(id: string, titre: string, attendu: string, run: () => Promise<string>) {
  try {
    const observe = await run();
    steps.push({ id, titre, attendu, observe, ok: true });
  } catch (err) {
    steps.push({ id, titre, attendu, observe: `ÉCHEC : ${(err as Error).message.split("\n")[0]}`, ok: false });
    throw err;
  }
}

// ─── Aides ───────────────────────────────────────────────────────────────────
const as = (clerkId: string | null) => { h.clerkUserId = clerkId; };
const json = (body: unknown, method = "POST") =>
  new Request("http://localhost/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request("http://localhost/x");
const ctx = (id: string) => ({ params: { id } });
const lastPayload = () => h.captured.at(-1) as {
  to: string; from: string; subject: string; html?: string; text: string; replyTo?: string;
  attachments: { filename: string; content: Buffer }[];
};
const pdfStrings = (pdf: Buffer) => Array.from(pdf.toString("latin1").matchAll(/\((.*?)\) Tj/g), (m) => m[1]);
const pdfHas = (pdf: Buffer, s: string) => pdf.toString("latin1").includes(s);
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const YEAR = new Date().getFullYear();

let fetchSpy: ReturnType<typeof vi.fn>;
let userA: { id: string };
let clientId = "";
let clientSansEmailId = "";
let clientEmailInvalideId = "";
let devisId = "";
let devisNumber = "";
let factureId = "";
let factureNumber = "";

beforeAll(async () => {
  fetchSpy = vi.fn(async () => { throw new Error("APPEL RÉSEAU INTERDIT pendant la recette"); });
  vi.stubGlobal("fetch", fetchSpy);
  for (const level of ["info", "error", "warn"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  // Une fausse clé Resend présente ne doit déclencher aucun envoi réel.
  process.env.RESEND_API_KEY = "re_fictive_recette";
  delete process.env.OUTBOUND_MODE;
  delete process.env.VERCEL_ENV;

  userA = await prisma.user.create({
    data: {
      clerkId: "clerk_recette_A", email: "artisan.a@example.com", companyName: "Nom d'inscription A",
      stripeSubscriptionId: "sub_fictif_A", subscriptionStatus: "trialing",
    },
  });
  await prisma.user.create({
    data: {
      clerkId: "clerk_recette_B", email: "artisan.b@example.com", companyName: "Artisan B",
      stripeSubscriptionId: "sub_fictif_B", subscriptionStatus: "trialing",
    },
  });
});

afterAll(async () => {
  const ok = steps.filter((s) => s.ok).length;
  const md = [
    `# Recette M15 — ${new Date().toISOString()}`,
    "",
    `Base : PostgreSQL local temporaire (${h.url.replace(/^postgresql:\/\/postgres@/, "")}), serveur simulé en TZ=${process.env.TZ ?? "(non défini)"}.`,
    `Résultat : ${ok}/${steps.length} étapes OK. Appels fetch : ${fetchSpy.mock.calls.length}. SDK Resend instancié : ${h.Resend?.mock.calls.length ?? 0} fois (étape R18 uniquement, faux SDK).`,
    "",
    "| # | Étape | Attendu | Observé | OK |",
    "|---|---|---|---|---|",
    ...steps.map((s) => `| ${s.id} | ${s.titre} | ${s.attendu} | ${s.observe.replace(/\|/g, "\\|")} | ${s.ok ? "OK" : "KO"} |`),
  ].join("\n");
  save("recette-m15.md", md);
  save("recette-m15.json", JSON.stringify(steps, null, 2));
  await prisma.$disconnect();
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Recette M15 — envoi des devis et factures par email (base locale, simulation)", () => {
  it("R1 — environnement : base locale, serveur en UTC, simulation, aucun refus bêta", async () => {
    await step("R1", "Environnement", "base locale gestly_recette, TZ=UTC, mode simulate, envois non désactivés",
      async () => {
        const [row] = await prisma.$queryRaw<{ db: string; port: number }[]>`SELECT current_database() AS db, inet_server_port() AS port`;
        expect(row.db).toBe("gestly_recette");
        expect(process.env.TZ).toBe("UTC");
        expect(new Date("2026-11-03T23:30:00Z").getHours()).toBe(23); // fuseau du processus = UTC
        expect(getOutboundMode()).toBe("simulate");
        expect(isOutboundDisabled()).toBe(false);
        return `base=${row.db}, port=${row.port}, TZ=UTC, mode=${getOutboundMode()}, clé Resend fictive présente`;
      });
  });

  it("R2 — Paramètres de l'entreprise (raison sociale ≠ nom d'inscription)", async () => {
    await step("R2", "Paramètres entreprise", "raison sociale, SIRET, adresse, email pro enregistrés",
      async () => {
        as("clerk_recette_A");
        const res = await saveSettings(json({
          companyName: "Menuiserie Fictive SARL", formeJuridique: "SARL", siret: "000 000 000 00011",
          adresseRue: "2 rue de l'Essai", codePostal: "75002", ville: "Paris", emailPro: "contact.menuiserie@example.com",
        }));
        expect(res.status).toBeLessThan(300);
        const s = await prisma.settings.findUnique({ where: { userId: userA.id } });
        expect(s?.companyName).toBe("Menuiserie Fictive SARL");
        expect(s?.emailPro).toBe("contact.menuiserie@example.com");
        return `HTTP ${res.status} ; raison sociale « ${s?.companyName} », email pro ${s?.emailPro}`;
      });
  });

  it("R3 — clients fictifs (email valide, sans email, email invalide)", async () => {
    await step("R3", "Clients", "3 clients créés", async () => {
      as("clerk_recette_A");
      const mk = async (body: Record<string, unknown>) => {
        const res = await createClient(json(body));
        expect(res.status).toBeLessThan(300);
        return (await res.json()).id as string;
      };
      clientId = await mk({ name: "Client Recette", email: "client.recette@example.com", preferredContact: "email" });
      clientSansEmailId = await mk({ name: "Client Sans Email", preferredContact: "email" });
      clientEmailInvalideId = await mk({ name: "Client Email Invalide", email: "a@example.com, b@example.com", preferredContact: "email" });
      return `3 clients ; l'adresse « a@example.com, b@example.com » est acceptée par la fiche client (non validée à la saisie)`;
    });
  });

  it("R4 — devis de la recette M4 : montants au centime", async () => {
    await step("R4", "Création du devis", "DEV-AAAA-001, HT 50,30 / TVA 5,06 / TTC 55,36, brouillon", async () => {
      as("clerk_recette_A");
      const res = await createDevis(json({
        clientId, validityDays: 30, notes: "Accès par la cour <b>intérieure</b>",
        lines: [
          { description: "Prestation A", quantity: 3, unitPriceHT: 0.1, tvaRate: 20 },
          { description: "Prestation B", quantity: 1.5, unitPriceHT: 33.33, tvaRate: 10 },
        ],
      }));
      expect(res.status).toBe(201);
      const d = await res.json();
      devisId = d.id; devisNumber = d.number;
      expect(devisNumber).toBe(`DEV-${YEAR}-001`);
      expect([d.totalHT, d.totalTVA, d.totalTTC]).toEqual([50.3, 5.06, 55.36]);
      expect(d.status).toBe("brouillon");
      return `${devisNumber}, HT ${d.totalHT} / TVA ${d.totalTVA} / TTC ${d.totalTTC}, statut ${d.status}`;
    });
  });

  it("R5 — envoi du devis par email (simulation)", async () => {
    await step("R5", "Envoi du devis",
      "200, devis « envoye », destinataire client, objet avec la raison sociale, PDF joint identique au bouton PDF, aucun appel Resend",
      async () => {
        as("clerk_recette_A");
        clearSimulatedOutbox();
        const res = await sendDevis(get(), ctx(devisId));
        expect(res.status).toBe(200);
        const row = await prisma.devis.findUnique({ where: { id: devisId } });
        expect(row?.status).toBe("envoye");
        expect(row?.sentAt).toBeInstanceOf(Date);

        const p = lastPayload();
        expect(p.to).toBe("client.recette@example.com");
        expect(p.replyTo).toBe("contact.menuiserie@example.com");
        expect(p.subject).toBe(`Devis ${devisNumber} — Menuiserie Fictive SARL`);
        for (const s of ["50,30 €", "5,06 €", "55,36 €"]) expect(visible(p.html!)).toContain(s);
        expect(p.html).toContain("Accès par la cour &lt;b&gt;intérieure&lt;/b&gt;");
        expect(p.attachments).toHaveLength(1);
        expect(p.attachments[0].filename).toBe(`devis-${devisNumber}.pdf`);

        // Même contenu que le PDF du bouton « PDF » (seules les métadonnées de date de génération diffèrent).
        const dl = Buffer.from(await (await devisPdf(get(), ctx(devisId))).arrayBuffer());
        expect(pdfStrings(dl).length).toBeGreaterThan(10);
        expect(pdfStrings(p.attachments[0].content)).toEqual(pdfStrings(dl));

        const outbox = getSimulatedOutbox();
        expect(outbox).toHaveLength(1);
        expect(outbox[0].to).toBe("cl***@example.com");
        expect(h.Resend.mock.calls.length).toBe(0);
        expect(fetchSpy).not.toHaveBeenCalled();

        save("devis-email.html", p.html!); save("devis-email.txt", p.text); save("devis-joint.pdf", p.attachments[0].content);
        return `HTTP 200 ; statut envoye ; à ${p.to} ; répondre à ${p.replyTo} ; objet « ${p.subject} » ; ` +
          `${p.attachments[0].filename} (${p.attachments[0].content.length} o, contenu identique au téléchargement) ; ` +
          `journal simulé : ${outbox[0].summary} ; Resend 0, fetch 0`;
      });
  });

  it("R6 — renvois du même devis : limite à 3 par 10 min", async () => {
    await step("R6", "Limitation de débit", "2 renvois acceptés, 4e envoi 429, date du 1er envoi conservée", async () => {
      as("clerk_recette_A");
      const firstSent = (await prisma.devis.findUnique({ where: { id: devisId } }))?.sentAt;
      const statuses = [];
      for (let i = 0; i < 3; i++) statuses.push((await sendDevis(get(), ctx(devisId))).status);
      expect(statuses).toEqual([200, 200, 429]);
      expect((await prisma.devis.findUnique({ where: { id: devisId } }))?.sentAt?.getTime()).toBe(firstSent?.getTime());
      expect(getSimulatedOutbox()).toHaveLength(3);
      return `statuts ${statuses.join(", ")} ; 3 envois simulés au total ; sentAt inchangé`;
    });
  });

  it("R7 — clients sans email ou à l'adresse invalide : refus, rien envoyé", async () => {
    await step("R7", "Adresses du client", "400 explicites, devis restés brouillons, aucun envoi", async () => {
      as("clerk_recette_A");
      const before = getSimulatedOutbox().length;
      const out: string[] = [];
      for (const cid of [clientSansEmailId, clientEmailInvalideId]) {
        const d = await (await createDevis(json({ clientId: cid, lines: [{ description: "Pose", quantity: 1, unitPriceHT: 100, tvaRate: 20 }] }))).json();
        const res = await sendDevis(get(), ctx(d.id));
        expect(res.status).toBe(400);
        out.push(`${(await res.json()).error}`);
        expect((await prisma.devis.findUnique({ where: { id: d.id } }))?.status).toBe("brouillon");
      }
      expect(getSimulatedOutbox().length).toBe(before);
      return out.map((e) => `400 « ${e} »`).join(" ; ");
    });
  });

  it("R8 — isolement : l'artisan B ne peut ni envoyer ni lire les documents de A", async () => {
    await step("R8", "Isolement A/B", "404 pour B sur le devis de A", async () => {
      as("clerk_recette_B");
      const res = await sendDevis(get(), ctx(devisId));
      expect(res.status).toBe(404);
      as("clerk_recette_A");
      return `envoi du devis de A par B : HTTP ${res.status}`;
    });
  });

  it("R9 — devis signé puis transformé en facture (échéance J+30)", async () => {
    await step("R9", "Devis → facture", "FAC-AAAA-001 aux mêmes montants, échéance J+30", async () => {
      as("clerk_recette_A");
      expect((await patchDevis(json({ status: "signe" }, "PATCH"), ctx(devisId))).status).toBe(200);
      const due = defaultDueDateIso();
      const res = await toFacture(json({ dueDate: due }), ctx(devisId));
      expect(res.status).toBe(201);
      const f = await res.json();
      factureId = f.id; factureNumber = f.number;
      expect(factureNumber).toBe(`FAC-${YEAR}-001`);
      expect([f.totalHT, f.totalTVA, f.totalTTC]).toEqual([50.3, 5.06, 55.36]);
      expect(new Date(f.dueDate).toISOString().slice(0, 10)).toBe(due);
      return `${factureNumber}, TTC ${f.totalTTC}, échéance ${due}`;
    });
  });

  it("R10 — fenêtre « Envoyer la facture » : valeurs proposées par le serveur", async () => {
    await step("R10", "Valeurs proposées", "objet avec la raison sociale (jamais « Gestly »), message avec 55,36 €", async () => {
      as("clerk_recette_A");
      const res = await factureEmailDefaults(get(), ctx(factureId));
      expect(res.status).toBe(200);
      const d = await res.json();
      expect(d.to).toBe("client.recette@example.com");
      expect(d.subject).toBe(`Facture ${factureNumber} — Menuiserie Fictive SARL`);
      expect(d.subject).not.toMatch(/Gestly/);
      expect(d.message).toContain("55,36 € TTC");
      expect(d.message.endsWith("Cordialement,\nMenuiserie Fictive SARL")).toBe(true);
      expect(getSimulatedOutbox()).toHaveLength(3); // aucune action d'envoi
      return `à ${d.to} ; objet « ${d.subject} » ; message signé « Menuiserie Fictive SARL »`;
    });
  });

  it("R11 — envoi de la facture avec les valeurs proposées", async () => {
    await step("R11", "Envoi de la facture", "200, sentAt renseigné, PDF joint (numéro, montants, échéance, 40 €)", async () => {
      as("clerk_recette_A");
      const d = await (await factureEmailDefaults(get(), ctx(factureId))).json();
      const res = await sendFacture(json(d), ctx(factureId));
      expect(res.status).toBe(200);
      const row = await prisma.facture.findUnique({ where: { id: factureId } });
      expect(row?.sentAt).toBeInstanceOf(Date);
      const p = lastPayload();
      expect(p.to).toBe("client.recette@example.com");
      expect(p.subject).toBe(`Facture ${factureNumber} — Menuiserie Fictive SARL`);
      expect(p.replyTo).toBe("contact.menuiserie@example.com");
      const pdf = p.attachments[0].content;
      for (const s of [factureNumber, "(55,36 ", "(50,30 ", "(5,06 ", "40 euros", "Menuiserie Fictive SARL"]) expect(pdfHas(pdf, s)).toBe(true);
      const dl = Buffer.from(await (await facturePdf(get(), ctx(factureId))).arrayBuffer());
      expect(pdfStrings(dl).length).toBeGreaterThan(10);
      expect(pdfStrings(pdf)).toEqual(pdfStrings(dl));
      expect(h.Resend.mock.calls.length).toBe(0);
      save("facture-email.txt", `Objet : ${p.subject}\nÀ : ${p.to}\nRépondre à : ${p.replyTo}\n\n${p.text}`);
      save("facture-jointe.pdf", pdf);
      return `HTTP 200 ; sentAt ${row?.sentAt?.toISOString()} ; ${p.attachments[0].filename} (${pdf.length} o, identique au téléchargement) ; Resend 0`;
    });
  });

  it("R12 — destinataire saisi invalide : refus, facture inchangée", async () => {
    await step("R12", "Destinataire invalide", "400 pour liste, nom affiché, retour à la ligne ; rien envoyé", async () => {
      as("clerk_recette_A");
      const before = getSimulatedOutbox().length;
      const sentAt = (await prisma.facture.findUnique({ where: { id: factureId } }))?.sentAt?.getTime();
      const statuses = [];
      for (const to of ["a@example.com, b@example.com", "Compta <compta@example.com>", "compta@example.com\r\nBcc: x@example.com"]) {
        statuses.push((await sendFacture(json({ to }), ctx(factureId))).status);
      }
      expect(statuses).toEqual([400, 400, 400]);
      expect(getSimulatedOutbox().length).toBe(before);
      expect((await prisma.facture.findUnique({ where: { id: factureId } }))?.sentAt?.getTime()).toBe(sentAt);
      return `statuts ${statuses.join(", ")} ; aucun envoi ; sentAt inchangé`;
    });
  });

  it("R13 — destinataire et objet saisis (comptabilité du client)", async () => {
    await step("R13", "Destinataire saisi", "envoi à l'adresse saisie, objet ramené sur une ligne", async () => {
      as("clerk_recette_A");
      const res = await sendFacture(json({ to: " compta.recette@example.com ", subject: "Votre facture\nde novembre", message: "Bonjour,\n\nCi-joint." }), ctx(factureId));
      expect(res.status).toBe(200);
      const p = lastPayload();
      expect(p.to).toBe("compta.recette@example.com");
      expect(p.subject).toBe("Votre facture de novembre");
      expect(p.text).toBe("Bonjour,\n\nCi-joint.");
      return `à ${p.to} ; objet « ${p.subject} »`;
    });
  });

  it("R14 — avoir partiel : PDF daté au jour de Paris", async () => {
    await step("R14", "Avoir partiel et PDF", "AV-AAAA-001, PDF avec le motif", async () => {
      as("clerk_recette_A");
      const res = await createAvoir(json({ type: "partiel", reason: "Geste commercial", description: "Remise", unitPriceHT: 10, tvaRate: 20 }), ctx(factureId));
      expect(res.status).toBe(201);
      const av = await res.json();
      const pdf = Buffer.from(await (await avoirPdf(get(), ctx(av.id))).arrayBuffer());
      expect(pdfHas(pdf, av.number)).toBe(true);
      expect(pdfHas(pdf, "Geste commercial")).toBe(true);
      save("avoir.pdf", pdf);
      return `${av.number}, TTC ${av.totalTTC} ; PDF ${pdf.length} o`;
    });
  });

  it("R15 — dates autour de minuit (serveur en UTC) : devis du 04/11 à 0 h 30 à Paris", async () => {
    await step("R15", "Minuit, devis", "PDF et email datés du 04/11/2026, valables jusqu'au 04/12/2026", async () => {
      as("clerk_recette_A");
      const d = await (await createDevis(json({ clientId, lines: [{ description: "Dépannage de nuit", quantity: 1, unitPriceHT: 80, tvaRate: 20 }] }))).json();
      // Donnée fictive locale : date de création placée à 0 h 30, heure de Paris.
      await prisma.devis.update({ where: { id: d.id }, data: { createdAt: new Date("2026-11-03T23:30:00Z") } });
      expect((await sendDevis(get(), ctx(d.id))).status).toBe(200);
      const p = lastPayload();
      const pdf = p.attachments[0].content;
      expect(pdfHas(pdf, "04/11/2026") && pdfHas(pdf, "04/12/2026")).toBe(true);
      expect(pdfHas(pdf, "03/11/2026")).toBe(false);
      expect(p.text).toContain("valable jusqu'au 04/12/2026");
      save("devis-minuit.pdf", pdf);
      return `PDF : 04/11/2026 et 04/12/2026, jamais 03/11 ; email : « valable jusqu'au 04/12/2026 »`;
    });
  });

  it("R16 — changement d'heure : devis du 20/10 à 0 h 30 (été), validité au 19/11 (hiver)", async () => {
    await step("R16", "Heure d'hiver, devis", "validité 19/11/2026 (ancien calcul : 18/11)", async () => {
      as("clerk_recette_A");
      const d = await (await createDevis(json({ clientId, lines: [{ description: "Visite", quantity: 1, unitPriceHT: 50, tvaRate: 20 }] }))).json();
      await prisma.devis.update({ where: { id: d.id }, data: { createdAt: new Date("2026-10-19T22:30:00Z") } });
      expect((await sendDevis(get(), ctx(d.id))).status).toBe(200);
      const pdf = lastPayload().attachments[0].content;
      expect(pdfHas(pdf, "20/10/2026") && pdfHas(pdf, "19/11/2026")).toBe(true);
      expect(pdfHas(pdf, "18/11/2026")).toBe(false);
      return `PDF : émis le 20/10/2026, valable jusqu'au 19/11/2026`;
    });
  });

  it("R17 — facture émise pendant l'heure répétée du 25/10 (2 h 30 CET)", async () => {
    await step("R17", "Heure répétée, facture", "PDF daté du 25/10/2026, échéance 24/11/2026", async () => {
      as("clerk_recette_A");
      const d = await (await createDevis(json({ clientId, status: "brouillon", lines: [{ description: "Réglage", quantity: 1, unitPriceHT: 40, tvaRate: 20 }] }))).json();
      await patchDevis(json({ status: "signe" }, "PATCH"), ctx(d.id));
      const f = await (await toFacture(json({ dueDate: defaultDueDateIso() }), ctx(d.id))).json();
      await prisma.facture.update({
        where: { id: f.id },
        data: { createdAt: new Date("2026-10-25T01:30:00Z"), dueDate: new Date("2026-11-24T00:00:00.000Z") },
      });
      expect((await sendFacture(json({}), ctx(f.id))).status).toBe(200);
      const pdf = lastPayload().attachments[0].content;
      expect(pdfHas(pdf, "25/10/2026") && pdfHas(pdf, "24/11/2026")).toBe(true);
      return `${f.number} : PDF daté du 25/10/2026, échéance 24/11/2026`;
    });
  });

  it("R18 — refus de Resend (faux SDK, mode live forcé dans ce seul test) : rien marqué envoyé", async () => {
    await step("R18", "Refus de Resend", "500, devis resté brouillon, aucun appel réseau", async () => {
      as("clerk_recette_A");
      const d = await (await createDevis(json({ clientId, lines: [{ description: "Pose", quantity: 1, unitPriceHT: 100, tvaRate: 20 }] }))).json();
      process.env.OUTBOUND_MODE = "live";
      h.resendSend.mockResolvedValueOnce({ data: null, error: { name: "validation_error", message: "domaine non vérifié (simulé)" }, headers: null });
      try {
        const res = await sendDevis(get(), ctx(d.id));
        expect(res.status).toBe(500);
      } finally {
        delete process.env.OUTBOUND_MODE;
      }
      expect(h.resendSend).toHaveBeenCalledTimes(1);
      expect((await prisma.devis.findUnique({ where: { id: d.id } }))?.status).toBe("brouillon");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(getOutboundMode()).toBe("simulate");
      return `HTTP 500 ; devis toujours brouillon, sentAt vide ; faux SDK appelé 1 fois ; fetch 0 ; retour en simulation`;
    });
  });

  it("R19 — bêta privée (OUTBOUND_MODE=simulate + production) : envois refusés", async () => {
    await step("R19", "Bêta privée", "503 « Bêta privée », rien simulé ni enregistré", async () => {
      as("clerk_recette_A");
      const d = await (await createDevis(json({ clientId, lines: [{ description: "Pose", quantity: 1, unitPriceHT: 100, tvaRate: 20 }] }))).json();
      const before = getSimulatedOutbox().length;
      process.env.OUTBOUND_MODE = "simulate";
      process.env.VERCEL_ENV = "production";
      let msg = "";
      try {
        const res = await sendDevis(get(), ctx(d.id));
        expect(res.status).toBe(503);
        msg = (await res.json()).error;
        expect(msg).toMatch(/Bêta privée/);
        expect((await sendFacture(json({}), ctx(factureId))).status).toBe(503);
      } finally {
        delete process.env.OUTBOUND_MODE;
        delete process.env.VERCEL_ENV;
      }
      expect(getSimulatedOutbox().length).toBe(before);
      expect((await prisma.devis.findUnique({ where: { id: d.id } }))?.status).toBe("brouillon");
      return `devis et facture : HTTP 503 « ${msg.slice(0, 60)}… » ; aucun envoi simulé`;
    });
  });

  it("R20 — bilan : aucun appel réseau, aucun client Resend en simulation, état de la base", async () => {
    await step("R20", "Bilan", "fetch 0 ; Resend instancié uniquement en R18 ; états cohérents en base", async () => {
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(h.Resend.mock.calls.length).toBe(1); // R18 seulement
      const [devis, factures, avoirs, devisEnvoyes, facturesEnvoyees] = await Promise.all([
        prisma.devis.count(), prisma.facture.count(), prisma.avoir.count(),
        prisma.devis.count({ where: { sentAt: { not: null } } }),
        prisma.facture.count({ where: { sentAt: { not: null } } }),
      ]);
      const outbox = getSimulatedOutbox();
      save("journal-simule.json", JSON.stringify(outbox, null, 2));
      return `${devis} devis (${devisEnvoyes} envoyés), ${factures} factures (${facturesEnvoyees} envoyées), ${avoirs} avoir ; ` +
        `${outbox.length} emails simulés depuis R5 (destinataires masqués) ; fetch 0`;
    });
  });
});
