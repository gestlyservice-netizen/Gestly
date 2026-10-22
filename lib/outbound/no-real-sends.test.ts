import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// Preuve qu'aucun envoi réel ne part en mode simulation, même lorsque des
// clés API d'apparence réelle sont présentes dans l'environnement :
//   - fetch global : tout appel fait échouer le test ;
//   - SDK Resend, client OVH et fonctions IA du SDK `ai` : espionnés ;
//   - les mêmes chemins en mode "live" (fetch simulé, aucun réseau) prouvent
//     que le garde-fou est la seule différence et que le chemin de
//     production est inchangé.

const mocks = vi.hoisted(() => {
  const resendSend = vi.fn(async () => ({ data: { id: "re_live" }, error: null, headers: null }));
  const ovhRequest = vi.fn(async () => ({ creditsLeft: 42 }));
  return {
    resendSend,
    Resend: vi.fn(() => ({ emails: { send: resendSend } })),
    ovhRequest,
    createOvhClient: vi.fn(() => ({ requestPromised: ovhRequest })),
    generateText: vi.fn(),
    generateObject: vi.fn(),
    transcribe: vi.fn(),
    getCurrentUser: vi.fn(),
    prisma: {
      devis: { findFirst: vi.fn() },
      relanceSettings: { findMany: vi.fn() },
      user: { findUnique: vi.fn() },
      facture: { findMany: vi.fn() },
      relance: { findUnique: vi.fn(), upsert: vi.fn() },
    },
  };
});

vi.mock("resend", () => ({ Resend: mocks.Resend }));
vi.mock("@/lib/sms/ovh-client", () => ({ createOvhClient: mocks.createOvhClient }));
vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("ai")>()),
  generateText: mocks.generateText,
  generateObject: mocks.generateObject,
  transcribe: mocks.transcribe,
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, isSubscriptionBlocked: () => false }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsage: vi.fn(), getMonthlyAiUsageCount: vi.fn(async () => 0) }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), createNotificationOnce: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

import { clearSimulatedOutbox, getSimulatedOutbox } from "@/lib/outbound/mode";
import { getEmailClient } from "@/lib/outbound/email";
import { sendWhatsappText, sendWhatsappDocument } from "@/lib/whatsapp/send";
import { uploadWhatsappMedia, getMediaMetadata, downloadMediaBuffer, MediaNotFoundError } from "@/lib/whatsapp/media";
import { sendSMS } from "@/lib/sms";
import { OvhProvider } from "@/lib/sms/ovh-provider";
import { getOvhSmsBalance, SIMULATED_SMS_CREDITS } from "@/lib/ovh-balance";
import { isAiConfigured, getWhatsappExtractionModel, getWhatsappTranscriptionModel } from "@/lib/ai/config";
import { extractDevisInfo } from "@/lib/whatsapp/extraction";
import { transcribeAudio, TranscriptionError } from "@/lib/whatsapp/transcription";
import { emptyPendingDevis } from "@/lib/whatsapp/pending-devis";
import { runRelancesCheck } from "@/lib/relances/engine";
import { POST as postDevisWhatsapp } from "@/app/api/devis/[id]/whatsapp/route";
import { POST as postImproveMessage } from "@/app/api/ai/improve-message/route";

// Valeurs FICTIVES, de la même forme que de vraies clés : la simulation doit
// tenir même quand toutes les variables de production sont présentes.
const FAKE_LIVE_ENV: Record<string, string> = {
  WHATSAPP_TOKEN: "fake-whatsapp-token-for-tests",
  WHATSAPP_PHONE_NUMBER_ID: "000000000000",
  OVH_APP_KEY: "fake-app-key",
  OVH_APP_SECRET: "fake-app-secret",
  OVH_CONSUMER_KEY: "fake-consumer-key",
  OVH_SMS_SERVICE_NAME: "fake-service",
  RESEND_API_KEY: "re_fake_for_tests",
  OPENAI_API_KEY: "fake-openai-key",
  AI_GATEWAY_API_KEY: "fake-gateway-key",
};
const CONTROLLED_KEYS = [...Object.keys(FAKE_LIVE_ENV), "OUTBOUND_MODE", "VERCEL_ENV", "WHATSAPP_GRAPH_API_BASE_URL"];

let savedEnv: Record<string, string | undefined> = {};
let fetchSpy: MockInstance<typeof fetch>;

function setMode(mode: "default" | "live") {
  if (mode === "live") process.env.OUTBOUND_MODE = "live";
  else delete process.env.OUTBOUND_MODE;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(CONTROLLED_KEYS.map((k) => [k, process.env[k]]));
  for (const k of CONTROLLED_KEYS) delete process.env[k];
  Object.assign(process.env, FAKE_LIVE_ENV);

  vi.clearAllMocks();
  clearSimulatedOutbox();
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("APPEL RÉSEAU INTERDIT dans les tests");
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of CONTROLLED_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

function expectNoExternalCall() {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mocks.Resend).not.toHaveBeenCalled();
  expect(mocks.resendSend).not.toHaveBeenCalled();
  expect(mocks.createOvhClient).not.toHaveBeenCalled();
  expect(mocks.ovhRequest).not.toHaveBeenCalled();
  expect(mocks.generateText).not.toHaveBeenCalled();
  expect(mocks.generateObject).not.toHaveBeenCalled();
  expect(mocks.transcribe).not.toHaveBeenCalled();
}

const devisFixture = {
  id: "devis_1",
  number: "DEV-001",
  totalTTC: 1200,
  client: { name: "Client Fictif", phone: "0600000000" },
};

describe("mode simulation (défaut hors production) — aucun appel externe malgré des clés présentes", () => {
  it("WhatsApp : texte, document, upload de média → simulés", async () => {
    const t = await sendWhatsappText("+33600000000", "Bonjour");
    const d = await sendWhatsappDocument("+33600000000", "media_1", "devis.pdf", "Votre devis");
    const u = await uploadWhatsappMedia(Buffer.from("%PDF"), "devis.pdf", "application/pdf");

    expect(t.messageId).toMatch(/^sim_wamid_/);
    expect(d.messageId).toMatch(/^sim_wamid_/);
    expect(u.mediaId).toMatch(/^sim_media_/);
    expect(getSimulatedOutbox().map((e) => e.channel)).toEqual([
      "whatsapp.text",
      "whatsapp.document",
      "whatsapp.media_upload",
    ]);
    expectNoExternalCall();
  });

  it("WhatsApp : récupération de média entrant bloquée (chemin d'erreur existant)", async () => {
    await expect(getMediaMetadata("media_in_1")).rejects.toBeInstanceOf(MediaNotFoundError);
    await expect(downloadMediaBuffer("https://lookaside.example/media")).rejects.toThrow(/simulation/);
    expectNoExternalCall();
  });

  it("WhatsApp : route devis (URL Meta en dur) → réponse simulée, aucun fetch", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    mocks.prisma.devis.findFirst.mockResolvedValue(devisFixture);

    const res = await postDevisWhatsapp(new Request("http://localhost/api/devis/devis_1/whatsapp", { method: "POST" }), {
      params: { id: "devis_1" },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, simulated: true });
    expect(body.messageId).toMatch(/^sim_wamid_/);
    expect(getSimulatedOutbox()[0]).toMatchObject({ channel: "whatsapp.template", to: "********0000" });
    expectNoExternalCall();
  });

  it("WhatsApp : route devis simulée même sans aucune variable WhatsApp", async () => {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    mocks.prisma.devis.findFirst.mockResolvedValue(devisFixture);

    const res = await postDevisWhatsapp(new Request("http://localhost/x", { method: "POST" }), { params: { id: "devis_1" } });

    expect(res.status).toBe(200);
    expectNoExternalCall();
  });

  it("SMS OVH : envoi et lecture du solde simulés, aucun client OVH créé", async () => {
    expect(await sendSMS("0600000000", "Relance", "Gestly")).toBe(true);
    expect(await new OvhProvider().sendSMS("0600000000", "Direct")).toBe(true);
    expect((await getOvhSmsBalance()).creditsLeft).toBe(SIMULATED_SMS_CREDITS);
    expectNoExternalCall();
  });

  it("Email Resend : client simulé, SDK Resend jamais instancié", async () => {
    const res = await getEmailClient().emails.send({
      from: "Gestly <onboarding@resend.dev>",
      to: "client@example.com",
      subject: "Test",
      text: "Bonjour",
    });

    expect(res.error).toBeNull();
    expect(res.data?.id).toMatch(/^sim_email_/);
    expect(getSimulatedOutbox()[0]).toMatchObject({ channel: "email", to: "cl***@example.com" });
    expectNoExternalCall();
  });

  it("IA : considérée non configurée, résolution de modèle réel refusée", async () => {
    expect(isAiConfigured()).toBe(false);
    expect(() => getWhatsappExtractionModel()).toThrow(/simulation/);
    expect(() => getWhatsappTranscriptionModel()).toThrow(/simulation/);

    await expect(
      extractDevisInfo({ userId: "user_1", message: "Devis peinture", recentHistory: [], currentPendingDevis: emptyPendingDevis() })
    ).rejects.toThrow();
    await expect(transcribeAudio(new Uint8Array([1, 2, 3]), "user_1")).rejects.toBeInstanceOf(TranscriptionError);
    expectNoExternalCall();
  });

  it("IA : route d'amélioration de message → 503, aucun appel generateText", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    const res = await postImproveMessage(
      new Request("http://localhost/api/ai/improve-message", { method: "POST", body: JSON.stringify({ draft: "Bonjour" }) })
    );

    expect(res.status).toBe(503);
    expectNoExternalCall();
  });

  it("Tâche asynchrone : moteur de relances (email + SMS) → envois simulés et tracés", async () => {
    mocks.prisma.relanceSettings.findMany.mockResolvedValue([
      {
        userId: "user_1", enabled: true, delaiJ1: 1, delaiJ2: 10, delaiJ3: 20,
        canalEmail: true, canalSms: true, messageJ1: null, messageJ2: null, messageJ3: null,
      },
    ]);
    mocks.prisma.user.findUnique.mockResolvedValue({ id: "user_1", companyName: "Entreprise Fictive" });
    mocks.prisma.facture.findMany.mockResolvedValue([
      {
        id: "fac_1", number: "FAC-001", totalTTC: 100,
        dueDate: new Date(Date.now() - 5 * 86_400_000),
        client: { name: "Client Fictif", email: "client@example.com", phone: "0600000000" },
        avoirs: [],
      },
    ]);
    mocks.prisma.relance.findUnique.mockResolvedValue(null);
    mocks.prisma.relance.upsert.mockResolvedValue({});

    const summary = await runRelancesCheck();

    expect(summary).toMatchObject({ sent: 2, failed: 0 });
    expect(getSimulatedOutbox().map((e) => e.channel).sort()).toEqual(["email", "sms", "sms.balance"]);
    expectNoExternalCall();
  });
});

describe("mode live (production) — chemin réel inchangé, réseau simulé par le test", () => {
  beforeEach(() => setMode("live"));

  it("WhatsApp : appelle l'API Graph avec l'URL et le token configurés", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.LIVE" }] }), { status: 200 }));

    const res = await sendWhatsappText("+33600000000", "Bonjour");

    expect(res.messageId).toBe("wamid.LIVE");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v18.0/000000000000/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer fake-whatsapp-token-for-tests");
    expect(getSimulatedOutbox()).toHaveLength(0);
  });

  it("WhatsApp : route devis → même URL Meta en dur et même template qu'avant", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "user_1" });
    mocks.prisma.devis.findFirst.mockResolvedValue(devisFixture);
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: "wamid.LIVE" }] }), { status: 200 }));

    const res = await postDevisWhatsapp(new Request("http://localhost/x", { method: "POST" }), { params: { id: "devis_1" } });

    expect(await res.json()).toEqual({ success: true, messageId: "wamid.LIVE" });
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v18.0/000000000000/messages");
    expect(JSON.parse(init.body as string).template.name).toBe("devis_client");
  });

  it("SMS : crée le client OVH et poste le job SMS", async () => {
    expect(await sendSMS("0600000000", "Relance")).toBe(true);
    expect(mocks.createOvhClient).toHaveBeenCalledWith("fake-app-key", "fake-app-secret", "fake-consumer-key");
    expect(mocks.ovhRequest).toHaveBeenCalledWith("POST", "/sms/fake-service/jobs", expect.any(Object));
  });

  it("Email : instancie le vrai SDK Resend avec la clé configurée", async () => {
    await getEmailClient().emails.send({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });
    expect(mocks.Resend).toHaveBeenCalledWith("re_fake_for_tests");
    expect(mocks.resendSend).toHaveBeenCalledTimes(1);
  });

  it("IA : configurée si une clé est présente", () => {
    expect(isAiConfigured()).toBe(true);
    expect(() => getWhatsappExtractionModel()).not.toThrow();
  });
});
