import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Recette V1, M13 : moteur de relances automatiques des factures, exécuté
// RÉELLEMENT (lib/relances/engine.ts, sendEmail, sendSMS, notifications) sur
// la base en mémoire (contraintes d'unicité du schéma, dont
// Relance(factureId, niveau, canal)). Resend est simulé ; tout appel réseau
// fait échouer le test. Aucune donnée Supabase.

const h = vi.hoisted(() => ({
  resendSend: vi.fn(),
  Resend: vi.fn(),
  clerkUserId: null as string | null,
}));
vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));
vi.mock("resend", () => ({ Resend: h.Resend }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: h.clerkUserId })), currentUser: vi.fn(async () => null) }));
vi.mock("@/lib/sms/ovh-client", () => ({ createOvhClient: vi.fn(() => { throw new Error("OVH réel interdit dans les tests"); }) }));
// Espion sur l'envoi SMS : délègue à la vraie fonction (simulée en test) pour lire le texte envoyé.
vi.mock("@/lib/sms", async (orig) => {
  const real = await orig<typeof import("@/lib/sms")>();
  return { ...real, sendSMS: vi.fn((...args: Parameters<typeof real.sendSMS>) => real.sendSMS(...args)) };
});

import { fakePrisma } from "@/tests/support/fake-prisma";
import { sendSMS } from "@/lib/sms";
import { runRelancesCheck } from "@/lib/relances/engine";
import { clearSimulatedOutbox, getSimulatedOutbox } from "@/lib/outbound/mode";
import { GET as cronRoute } from "@/app/api/relances/check/route";
import { POST as saveRelanceSettings } from "@/app/api/settings/relances/route";

const DAY = 86_400_000;
const ENV_KEYS = ["OUTBOUND_MODE", "VERCEL_ENV", "RESEND_API_KEY", "CRON_SECRET"] as const;
let savedEnv: Record<string, string | undefined> = {};

type R = Record<string, any>;
const seed = (model: string, data: R) => fakePrisma.seed(model, data) as R;
const rows = (model: string) => fakePrisma.rows(model) as R[];

let userA: R, userB: R, clientA: R, clientB: R;

function enableRelances(userId: string, extra: R = {}) {
  return seed("relanceSettings", { userId, enabled: true, delaiJ1: 3, delaiJ2: 10, delaiJ3: 21, canalEmail: true, canalSms: false, ...extra });
}
// Facture échue depuis `days` jours (+ 1 h pour éviter les bords de journée).
function overdue(userId: string, clientId: string, days: number, extra: R = {}) {
  return seed("facture", {
    userId, clientId, number: `FAC-${userId}-${days}-${Math.random().toString(36).slice(2, 6)}`,
    status: "emise", totalHT: 100, totalTVA: 20, totalTTC: 120,
    dueDate: new Date(Date.now() - days * DAY - 3_600_000), ...extra,
  });
}
const sent = () => getSimulatedOutbox().filter((m) => m.channel === "email");
// Texte des emails : lu sur le client Resend simulé (mode live factice, réseau interdit).
const OK = { data: { id: "re_1" }, error: null };
const live = () => { process.env.OUTBOUND_MODE = "live"; process.env.RESEND_API_KEY = "re_fake_tests"; };
const emailTexts = () => h.resendSend.mock.calls.map((c) => c[0].text as string);

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  fakePrisma.reset();
  clearSimulatedOutbox();
  vi.clearAllMocks();
  h.Resend.mockImplementation(() => ({ emails: { send: h.resendSend } }));
  h.clerkUserId = null;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => { throw new Error("APPEL RÉSEAU INTERDIT"); });
  for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
  userA = seed("user", { clerkId: "clerk_A", email: "a@example.com", companyName: "Artisan A", stripeSubscriptionId: "sub_A", subscriptionStatus: "active" });
  userB = seed("user", { clerkId: "clerk_B", email: "b@example.com", companyName: "Artisan B", stripeSubscriptionId: "sub_B", subscriptionStatus: "active" });
  clientA = seed("client", { userId: userA.id, name: "Client A", email: "client.a@example.com", phone: "+33600000001" });
  clientB = seed("client", { userId: userB.id, name: "Client B", email: "client.b@example.com", phone: "+33600000002" });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

describe("1. déclenchement automatique (cron Vercel)", () => {
  it("vercel.json planifie /api/relances/check chaque jour, et la route est exclue de la protection Clerk", () => {
    const cfg = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));
    expect(cfg.crons).toContainEqual({ path: "/api/relances/check", schedule: "0 6 * * *" });
    expect(readFileSync(join(process.cwd(), "middleware.ts"), "utf8")).toContain('"/api/relances/check"');
  });

  it("route cron : refusée sans le secret ou avec un mauvais secret, exécutée avec le bon (en-tête envoyé par Vercel)", async () => {
    process.env.CRON_SECRET = "secret-test";
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    const call = (auth?: string) => cronRoute(new Request("http://localhost/api/relances/check", { headers: auth ? { authorization: auth } : {} }));
    expect((await call()).status).toBe(401);
    expect((await call("Bearer mauvais")).status).toBe(401);
    expect(sent()).toHaveLength(0);
    const ok = await call("Bearer secret-test");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ sent: 1 });
  });
});

describe("2. délais 3 / 10 / 21 jours après échéance", () => {
  it.each([
    [2, null], [3, 1], [9, 1], [10, 2], [20, 2], [21, 3], [60, 3],
  ])("échue depuis %i jour(s) → niveau %s", async (days, niveau) => {
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, days);
    await runRelancesCheck();
    const r = rows("relance");
    if (niveau === null) expect(r).toHaveLength(0);
    else expect(r.map((x) => [x.niveau, x.statut])).toEqual([[niveau, "envoyee"]]);
  });

  it("progression : J1 à 3 jours, puis J2 à 10 jours, puis J3 à 21 jours, une seule fois chacune", async () => {
    enableRelances(userA.id);
    const f = overdue(userA.id, clientA.id, 3);
    await runRelancesCheck();
    for (const days of [10, 21]) {
      fakePrisma.store.facture.find((x) => x.id === f.id)!.dueDate = new Date(Date.now() - days * DAY - 3_600_000);
      await runRelancesCheck();
      await runRelancesCheck();
    }
    expect(rows("relance").map((x) => x.niveau).sort()).toEqual([1, 2, 3]);
    expect(sent()).toHaveLength(3);
  });

  it("délais personnalisés (5 / 15 / 30) appliqués", async () => {
    enableRelances(userA.id, { delaiJ1: 5, delaiJ2: 15, delaiJ3: 30 });
    overdue(userA.id, clientA.id, 4);
    overdue(userA.id, clientA.id, 16);
    await runRelancesCheck();
    expect(rows("relance").map((x) => x.niveau)).toEqual([2]);
  });

  it("facture non échue ou sans date d'échéance : aucune relance", async () => {
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, -5);
    overdue(userA.id, clientA.id, 0, { dueDate: null });
    await runRelancesCheck();
    expect(rows("relance")).toHaveLength(0);
  });

  it("[régression] paramètres : délais non croissants ou non entiers refusés (400), rien d'enregistré", async () => {
    const save = (body: R) => saveRelanceSettings(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ enabled: true, canalEmail: true, ...body }) }));
    h.clerkUserId = userA.clerkId;
    expect((await save({ delaiJ1: 10, delaiJ2: 3, delaiJ3: 21 })).status).toBe(400);
    expect((await save({ delaiJ1: 3, delaiJ2: 10, delaiJ3: 10 })).status).toBe(400);
    expect((await save({ delaiJ1: 3.5, delaiJ2: 10, delaiJ3: 21 })).status).toBe(400);
    expect((await save({ delaiJ1: 3, delaiJ2: 10, delaiJ3: 5000 })).status).toBe(400);
    expect(rows("relanceSettings")).toHaveLength(0);
    const ok = await save({ delaiJ1: 3, delaiJ2: 10, delaiJ3: 21 });
    expect(ok.status).toBe(200);
    expect(rows("relanceSettings")[0]).toMatchObject({ delaiJ1: 3, delaiJ2: 10, delaiJ3: 21, enabled: true });
  });
});

describe("3–4. factures exclues et montant restant dû", () => {
  it("payée : aucune relance", async () => {
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 30, { status: "payee", paidAt: new Date() });
    await runRelancesCheck();
    expect(sent()).toHaveLength(0);
  });

  it("soldée par avoir intégral, ou par des avoirs partiels cumulés : aucune relance", async () => {
    enableRelances(userA.id);
    const f1 = overdue(userA.id, clientA.id, 30);
    seed("avoir", { userId: userA.id, factureId: f1.id, clientId: clientA.id, number: "AV-1", type: "total", reason: "x", totalHT: 100, totalTVA: 20, totalTTC: 120 });
    const f2 = overdue(userA.id, clientA.id, 30);
    seed("avoir", { userId: userA.id, factureId: f2.id, clientId: clientA.id, number: "AV-2", type: "partiel", reason: "x", totalHT: 50, totalTVA: 10, totalTTC: 60 });
    seed("avoir", { userId: userA.id, factureId: f2.id, clientId: clientA.id, number: "AV-3", type: "partiel", reason: "x", totalHT: 50, totalTVA: 10, totalTTC: 60 });
    const summary = await runRelancesCheck();
    expect(summary).toMatchObject({ sent: 0, skipped: 2 });
    expect(rows("relance")).toHaveLength(0);
  });

  it("avoir partiel : la relance réclame le reste dû au centime", async () => {
    enableRelances(userA.id);
    const f = overdue(userA.id, clientA.id, 4, { totalTTC: 55.36 });
    seed("avoir", { userId: userA.id, factureId: f.id, clientId: clientA.id, number: "AV-1", type: "partiel", reason: "x", totalHT: 10, totalTVA: 2, totalTTC: 12 });
    live();
    h.resendSend.mockResolvedValue(OK);
    await runRelancesCheck();
    expect(emailTexts()).toHaveLength(1);
    expect(emailTexts()[0]).toContain("43,36 €");
    expect(emailTexts()[0]).not.toContain("55,36");
  });
});

describe("5. doublons et isolement", () => {
  it("deux passages successifs : une seule relance par niveau et par canal", async () => {
    enableRelances(userA.id, { canalSms: true });
    overdue(userA.id, clientA.id, 4);
    await runRelancesCheck();
    await runRelancesCheck();
    expect(rows("relance").map((r) => r.canal).sort()).toEqual(["email", "sms"]);
    // (la consultation simulée du solde SMS, « sms.balance », n'est pas un envoi)
    expect(getSimulatedOutbox().filter((m) => m.channel === "email" || m.channel === "sms")).toHaveLength(2);
  });

  it("[régression] deux exécutions SIMULTANÉES du cron : un seul email (avant : deux)", async () => {
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    await Promise.all([runRelancesCheck(), runRelancesCheck()]);
    expect(sent()).toHaveLength(1);
    expect(rows("relance")).toHaveLength(1);
    expect(rows("relance")[0].statut).toBe("envoyee");
  });

  it("isolement : chaque compte avec ses propres réglages ; relances désactivées ou abonnement suspendu = aucune relance", async () => {
    enableRelances(userA.id, { delaiJ1: 3 });
    seed("relanceSettings", { userId: userB.id, enabled: false });
    overdue(userA.id, clientA.id, 4);
    overdue(userB.id, clientB.id, 40);
    const userC = seed("user", { clerkId: "clerk_C", email: "c@example.com", companyName: "Artisan C", stripeSubscriptionId: "sub_C", subscriptionStatus: "canceled" });
    const clientC = seed("client", { userId: userC.id, name: "Client C", email: "client.c@example.com" });
    enableRelances(userC.id);
    overdue(userC.id, clientC.id, 40);
    await runRelancesCheck();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].summary).toContain(`FAC-${userA.id}-`);
    expect(rows("relance")).toHaveLength(1);
    // Notifications uniquement pour le compte concerné.
    expect(new Set(rows("notification").map((n) => n.userId))).toEqual(new Set([userA.id]));
  });
});

describe("6. erreurs et nouvelles tentatives", () => {
  const REFUSED = { data: null, error: { name: "validation_error", message: "domaine non vérifié" } };

  it("refus de Resend : relance en échec, réessayée au passage suivant, puis envoyée", async () => {
    live();
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    h.resendSend.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce(OK);
    expect(await runRelancesCheck()).toMatchObject({ sent: 0, failed: 1 });
    expect(rows("relance")[0]).toMatchObject({ statut: "echec", attempts: 1, erreur: expect.stringContaining("domaine non vérifié") });
    expect(await runRelancesCheck()).toMatchObject({ sent: 1, failed: 0 });
    expect(rows("relance")[0]).toMatchObject({ statut: "envoyee", attempts: 2, erreur: null });
    expect(rows("notification").map((n) => n.type)).toEqual(expect.arrayContaining(["relance_echouee", "relance_envoyee"]));
  });

  it("5 échecs : abandon, plus aucune tentative", async () => {
    live();
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    h.resendSend.mockResolvedValue(REFUSED);
    for (let i = 0; i < 7; i++) await runRelancesCheck();
    expect(h.resendSend).toHaveBeenCalledTimes(5);
    expect(rows("relance")[0]).toMatchObject({ statut: "echec", attempts: 5 });
  });

  it("réservation « en_cours » récente (autre exécution en plein envoi) : pas de second envoi ; abandonnée depuis plus d'une heure : reprise", async () => {
    enableRelances(userA.id);
    const f = overdue(userA.id, clientA.id, 4);
    seed("relance", { factureId: f.id, niveau: 1, canal: "email", statut: "en_cours", attempts: 0, envoyeeAt: new Date(Date.now() - 5 * 60_000) });
    await runRelancesCheck();
    expect(sent()).toHaveLength(0);
    fakePrisma.store.relance[0].envoyeeAt = new Date(Date.now() - 2 * 3_600_000);
    await runRelancesCheck();
    expect(sent()).toHaveLength(1);
    expect(rows("relance")[0]).toMatchObject({ statut: "envoyee", attempts: 1 });
  });

  it("[régression] incident APRÈS l'envoi (notification impossible) : jamais marquée en échec, donc jamais renvoyée", async () => {
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    fakePrisma.failNext("notification.create", new Error("panne notifications"), (a) => (a as R).data.type === "relance_envoyee");
    await runRelancesCheck();
    await runRelancesCheck();
    expect(sent()).toHaveLength(1);
    expect(rows("relance")[0].statut).toBe("envoyee");
  });

  it("client sans email : ignoré sans échec ni tentative", async () => {
    enableRelances(userA.id);
    const noEmail = seed("client", { userId: userA.id, name: "Sans email", email: null });
    overdue(userA.id, noEmail.id, 4);
    expect(await runRelancesCheck()).toMatchObject({ sent: 0, failed: 0, skipped: 1 });
    expect(rows("relance")).toHaveLength(0);
  });

  it("live sans clé Resend : échec explicite, aucun appel", async () => {
    process.env.OUTBOUND_MODE = "live";
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 4);
    expect(await runRelancesCheck()).toMatchObject({ failed: 1 });
    expect(rows("relance")[0].erreur).toMatch(/RESEND_API_KEY/);
    expect(h.Resend).not.toHaveBeenCalled();
  });

  it("[régression] une erreur sur un compte n'interrompt pas les relances des autres comptes", async () => {
    enableRelances(userA.id);
    enableRelances(userB.id);
    overdue(userA.id, clientA.id, 4);
    overdue(userB.id, clientB.id, 4);
    fakePrisma.failNext("facture.findMany", new Error("panne base"), (args) => (args as R).where.userId === userA.id);
    const summary = await runRelancesCheck();
    expect(sent()).toHaveLength(1);
    expect(sent()[0].summary).toContain(`FAC-${userB.id}-`);
    expect(summary.failed).toBeGreaterThanOrEqual(1);
  });
});

describe("7. OUTBOUND_MODE=simulate : aucun envoi réel", () => {
  it("simulation (local, Preview) : relance journalisée et simulée, aucun client Resend ni appel réseau", async () => {
    enableRelances(userA.id, { canalSms: true });
    overdue(userA.id, clientA.id, 4);
    expect(await runRelancesCheck()).toMatchObject({ sent: 2 });
    expect(h.Resend).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(getSimulatedOutbox().map((m) => m.channel).sort()).toEqual(["email", "sms", "sms.balance"]);
  });

  it("bêta privée en production (OUTBOUND_MODE=simulate + VERCEL_ENV=production) : rien n'est envoyé ni enregistré", async () => {
    process.env.OUTBOUND_MODE = "simulate";
    process.env.VERCEL_ENV = "production";
    enableRelances(userA.id);
    overdue(userA.id, clientA.id, 40);
    expect(await runRelancesCheck()).toEqual({ usersChecked: 0, facturesChecked: 0, sent: 0, failed: 0, skipped: 0 });
    expect(getSimulatedOutbox()).toHaveLength(0);
    expect(rows("relance")).toHaveLength(0);
    expect(rows("notification")).toHaveLength(0);
    expect(h.Resend).not.toHaveBeenCalled();
  });
});

describe("8. messages personnalisés", () => {
  const custom = { messageJ2: "Rappel {number} : {amount} € dus depuis {daysLate} j. {clientName} / {companyName}" };
  const checkText = (text: string) => {
    expect(text).toContain("Rappel FAC-2026-009 : ");
    expect(text).toMatch(/1\s234,50 € dus depuis 12 j\./);
    expect(text).toContain("Client A / Artisan A");
    expect(text).not.toMatch(/\{(number|amount|daysLate|clientName|companyName)\}/);
  };

  it("email : variables remplacées dans le message personnalisé du niveau", async () => {
    enableRelances(userA.id, custom);
    overdue(userA.id, clientA.id, 12, { number: "FAC-2026-009", totalTTC: 1234.5 });
    live();
    h.resendSend.mockResolvedValue(OK);
    await runRelancesCheck();
    expect(emailTexts()).toHaveLength(1);
    checkText(emailTexts()[0]);
  });

  it("SMS : même message personnalisé", async () => {
    enableRelances(userA.id, { ...custom, canalEmail: false, canalSms: true });
    overdue(userA.id, clientA.id, 12, { number: "FAC-2026-009", totalTTC: 1234.5 });
    await runRelancesCheck();
    expect(vi.mocked(sendSMS)).toHaveBeenCalledTimes(1);
    checkText(vi.mocked(sendSMS).mock.calls[0][1]);
  });

  it("message vide ou blanc : modèle par défaut du niveau", async () => {
    enableRelances(userA.id, { messageJ1: "   " });
    overdue(userA.id, clientA.id, 4);
    live();
    h.resendSend.mockResolvedValue(OK);
    await runRelancesCheck();
    expect(emailTexts()[0]).toContain("Sauf erreur de notre part");
  });
});
