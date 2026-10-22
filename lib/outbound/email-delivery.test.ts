import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Correction Resend : `resend.emails.send()` renvoie `{ data: null, error }`
// sans lever d'exception quand l'API refuse un email. Ces tests prouvent
// qu'un tel refus n'est jamais compté comme un envoi réussi : ni par
// sendEmail(), ni par les parcours qui marquent un document "envoyé".

const mocks = vi.hoisted(() => {
  const resendSend = vi.fn();
  return {
    resendSend,
    Resend: vi.fn(() => ({ emails: { send: resendSend } })),
    getCurrentUser: vi.fn(),
    auth: vi.fn(async () => ({ userId: null })),
    generatePdf: vi.fn(() => Buffer.from("%PDF-fictif")),
    prisma: {
      devis: { findFirst: vi.fn(), update: vi.fn() },
      facture: { findFirst: vi.fn(), update: vi.fn(), findMany: vi.fn() },
      settings: { findUnique: vi.fn() },
      relanceSettings: { findMany: vi.fn() },
      user: { findUnique: vi.fn() },
      relance: { findUnique: vi.fn(), upsert: vi.fn() },
      ovhBalanceAlert: { findFirst: vi.fn(), create: vi.fn() },
    },
    createNotification: vi.fn(),
  };
});

vi.mock("resend", () => ({ Resend: mocks.Resend }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, isSubscriptionBlocked: () => false }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/pdf/generate-document-pdf", () => ({ generateDocumentPdfBuffer: mocks.generatePdf }));
vi.mock("@/lib/notifications", () => ({ createNotification: mocks.createNotification, createNotificationOnce: vi.fn() }));
vi.mock("@/lib/sms/ovh-client", () => ({ createOvhClient: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { sendEmail, EmailSendError, canSendEmail } from "@/lib/outbound/email";
import { clearSimulatedOutbox, getSimulatedOutbox } from "@/lib/outbound/mode";
import { POST as sendDevis } from "@/app/api/devis/[id]/send/route";
import { POST as sendFacture } from "@/app/api/factures/[id]/send/route";
import { GET as checkOvhBalance } from "@/app/api/admin/ovh-balance/check/route";
import { runRelancesCheck } from "@/lib/relances/engine";

const ENV_KEYS = ["OUTBOUND_MODE", "VERCEL_ENV", "RESEND_API_KEY", "CRON_SECRET"];
let savedEnv: Record<string, string | undefined> = {};

const RESEND_OK = { data: { id: "re_123" }, error: null, headers: null };
const RESEND_REFUSED = {
  data: null,
  error: { name: "validation_error", message: "The gestly.fr domain is not verified" },
  headers: null,
};

function live() {
  process.env.OUTBOUND_MODE = "live";
  process.env.RESEND_API_KEY = "re_fake_for_tests";
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  vi.clearAllMocks();
  clearSimulatedOutbox();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("APPEL RÉSEAU INTERDIT dans les tests");
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

const payload = { from: "Gestly <a@example.com>", to: "client@example.com", subject: "Test", text: "Bonjour" };

describe("sendEmail()", () => {
  it("live, succès : renvoie l'identifiant Resend", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_OK);
    await expect(sendEmail(payload)).resolves.toEqual({ id: "re_123" });
    expect(mocks.Resend).toHaveBeenCalledWith("re_fake_for_tests");
  });

  it("live, refus de Resend ({ error }) : lève EmailSendError avec le message", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const err = await sendEmail(payload).catch((e) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect(err.message).toMatch(/domain is not verified/);
    expect(err.code).toBe("validation_error");
  });

  it("live, réponse sans identifiant : lève EmailSendError", async () => {
    live();
    mocks.resendSend.mockResolvedValue({ data: null, error: null, headers: null });
    await expect(sendEmail(payload)).rejects.toBeInstanceOf(EmailSendError);
  });

  it("live, erreur réseau du SDK : propagée", async () => {
    live();
    mocks.resendSend.mockRejectedValue(new Error("ECONNRESET"));
    await expect(sendEmail(payload)).rejects.toThrow("ECONNRESET");
  });

  it("simulation : identifiant simulé, SDK Resend jamais instancié, aucune clé requise", async () => {
    const res = await sendEmail(payload);
    expect(res.id).toMatch(/^sim_email_/);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(getSimulatedOutbox()).toHaveLength(1);
    expect(canSendEmail()).toBe(true);
  });

  it("canSendEmail : en live, exige RESEND_API_KEY", () => {
    process.env.OUTBOUND_MODE = "live";
    expect(canSendEmail()).toBe(false);
    process.env.RESEND_API_KEY = "re_fake_for_tests";
    expect(canSendEmail()).toBe(true);
  });
});

const user = { id: "user_1", companyName: "Entreprise Fictive" };
const devis = {
  id: "devis_1", number: "DEV-001", status: "brouillon", sentAt: null,
  createdAt: new Date("2026-10-01"), validityDays: 30, notes: null,
  totalHT: 100, totalTVA: 20, totalTTC: 120, lines: [],
  client: { name: "Client Fictif", email: "client@example.com" },
};
const facture = {
  id: "fac_1", number: "FAC-001", createdAt: new Date("2026-10-01"), dueDate: null, notes: null,
  totalHT: 100, totalTVA: 20, totalTTC: 120, lines: [], devis: null,
  client: { name: "Client Fictif", email: "client@example.com" },
};
const req = (body?: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

describe("POST /api/devis/[id]/send", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.prisma.devis.findFirst.mockResolvedValue(devis);
    mocks.prisma.devis.update.mockResolvedValue({ ...devis, status: "envoye" });
  });

  it("live, refus de Resend : 500 et devis NON marqué envoyé", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const res = await sendDevis(req(), { params: { id: "devis_1" } });
    expect(res.status).toBe(500);
    expect(mocks.prisma.devis.update).not.toHaveBeenCalled();
  });

  it("live, succès : devis marqué envoyé", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_OK);
    const res = await sendDevis(req(), { params: { id: "devis_1" } });
    expect(res.status).toBe(200);
    expect(mocks.prisma.devis.update).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.devis.update.mock.calls[0][0].data.status).toBe("envoye");
  });

  it("simulation : envoi simulé, devis marqué envoyé, aucun appel Resend", async () => {
    const res = await sendDevis(req(), { params: { id: "devis_1" } });
    expect(res.status).toBe(200);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(mocks.prisma.devis.update).toHaveBeenCalledTimes(1);
    expect(getSimulatedOutbox()[0].channel).toBe("email");
  });
});

describe("POST /api/factures/[id]/send", () => {
  beforeEach(() => {
    mocks.getCurrentUser.mockResolvedValue(user);
    mocks.prisma.facture.findFirst.mockResolvedValue(facture);
    mocks.prisma.settings.findUnique.mockResolvedValue(null);
    mocks.prisma.facture.update.mockResolvedValue({ ...facture, sentAt: new Date() });
  });

  it("live, refus de Resend : 500 et facture NON marquée envoyée", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const res = await sendFacture(req({}), { params: { id: "fac_1" } });
    expect(res.status).toBe(500);
    expect(mocks.prisma.facture.update).not.toHaveBeenCalled();
  });

  it("live, succès : facture marquée envoyée, PDF joint", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_OK);
    const res = await sendFacture(req({}), { params: { id: "fac_1" } });
    expect(res.status).toBe(200);
    expect(mocks.prisma.facture.update).toHaveBeenCalledTimes(1);
    expect(mocks.resendSend.mock.calls[0][0].attachments).toHaveLength(1);
  });

  it("simulation : facture marquée envoyée, aucun appel Resend", async () => {
    const res = await sendFacture(req({}), { params: { id: "fac_1" } });
    expect(res.status).toBe(200);
    expect(mocks.Resend).not.toHaveBeenCalled();
    expect(mocks.prisma.facture.update).toHaveBeenCalledTimes(1);
  });
});

describe("relances (email)", () => {
  beforeEach(() => {
    mocks.prisma.relanceSettings.findMany.mockResolvedValue([
      {
        userId: "user_1", enabled: true, delaiJ1: 1, delaiJ2: 10, delaiJ3: 20,
        canalEmail: true, canalSms: false, messageJ1: null, messageJ2: null, messageJ3: null,
      },
    ]);
    mocks.prisma.user.findUnique.mockResolvedValue(user);
    mocks.prisma.facture.findMany.mockResolvedValue([
      {
        id: "fac_1", number: "FAC-001", totalTTC: 120,
        dueDate: new Date(Date.now() - 5 * 86_400_000),
        client: { name: "Client Fictif", email: "client@example.com", phone: null },
        avoirs: [],
      },
    ]);
    mocks.prisma.relance.findUnique.mockResolvedValue(null);
    mocks.prisma.relance.upsert.mockResolvedValue({});
  });

  it("live, refus de Resend : relance enregistrée en ÉCHEC, jamais « envoyee »", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const summary = await runRelancesCheck();
    expect(summary).toMatchObject({ sent: 0, failed: 1 });
    const upsert = mocks.prisma.relance.upsert.mock.calls[0][0];
    expect(upsert.create.statut).toBe("echec");
    expect(upsert.update.statut).toBe("echec");
    expect(upsert.create.erreur).toMatch(/domain is not verified/);
    expect(mocks.createNotification.mock.calls[0][1]).toBe("relance_echouee");
  });

  it("live, succès : relance « envoyee »", async () => {
    live();
    mocks.resendSend.mockResolvedValue(RESEND_OK);
    const summary = await runRelancesCheck();
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.prisma.relance.upsert.mock.calls[0][0].create.statut).toBe("envoyee");
  });

  it("simulation : relance « envoyee » (simulée), aucun appel Resend", async () => {
    const summary = await runRelancesCheck();
    expect(summary).toMatchObject({ sent: 1, failed: 0 });
    expect(mocks.Resend).not.toHaveBeenCalled();
  });
});

describe("GET /api/admin/ovh-balance/check (alerte email)", () => {
  beforeEach(async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.prisma.ovhBalanceAlert.findFirst.mockResolvedValue(null);
    mocks.prisma.ovhBalanceAlert.create.mockResolvedValue({});
    const { createOvhClient } = await import("@/lib/sms/ovh-client");
    vi.mocked(createOvhClient).mockReturnValue({ requestPromised: vi.fn(async () => ({ creditsLeft: 5 })) });
    process.env.OVH_APP_KEY = process.env.OVH_APP_SECRET = process.env.OVH_CONSUMER_KEY = process.env.OVH_SMS_SERVICE_NAME = "fake";
  });

  afterEach(() => {
    for (const k of ["OVH_APP_KEY", "OVH_APP_SECRET", "OVH_CONSUMER_KEY", "OVH_SMS_SERVICE_NAME"]) delete process.env[k];
  });

  const cronReq = () => new Request("http://localhost/x", { headers: { authorization: "Bearer test-cron-secret" } });

  it("live, refus de Resend : alerte NON enregistrée (sera retentée)", async () => {
    live();
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.resendSend.mockResolvedValue(RESEND_REFUSED);
    const res = await checkOvhBalance(cronReq());
    expect((await res.json()).alertsSent).toEqual([]);
    expect(mocks.prisma.ovhBalanceAlert.create).not.toHaveBeenCalled();
  });

  it("live, succès : alertes enregistrées", async () => {
    live();
    process.env.CRON_SECRET = "test-cron-secret";
    mocks.resendSend.mockResolvedValue(RESEND_OK);
    const res = await checkOvhBalance(cronReq());
    const { alertsSent } = await res.json();
    expect(alertsSent.length).toBeGreaterThan(0);
    expect(mocks.prisma.ovhBalanceAlert.create).toHaveBeenCalledTimes(alertsSent.length);
  });
});
