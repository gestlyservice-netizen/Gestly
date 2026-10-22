import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { createHmac } from "node:crypto";
import type { RawExtraction, RawExtractedLine } from "@/lib/whatsapp/pending-devis";

// Tests d'INTÉGRATION du parcours WhatsApp complet :
//   webhook Meta signé → WhatsappJob → agent → extraction IA (checkpoint)
//   → résolution / création client → confirmation → createDevis
//   → confirmation d'envoi → PDF → upload média → document WhatsApp.
//
// Tout le code applicatif du parcours s'exécute réellement. Seuls sont
// remplacés :
//   - la base : tests/support/fake-prisma.ts (en mémoire, contraintes
//     d'unicité et transactions avec annulation) — jamais Supabase ;
//   - l'IA : modèles simulés du SDK (ai/test), réponses scriptées ;
//   - le PDF (contenu factice) et waitUntil (attendu explicitement) ;
//   - les envois : mode simulation réel (lib/outbound/mode.ts) — aucun
//     appel Meta, et fetch fait échouer le test s'il est appelé.

const h = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  extractions: [] as unknown[],
  extractionPrompts: [] as string[],
  transcriptions: [] as unknown[],
  media: null as null | { mimeType: string },
}));

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));
vi.mock("@vercel/functions", () => ({ waitUntil: (p: Promise<unknown>) => void h.pending.push(p) }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: null })), currentUser: vi.fn(async () => null) }));
vi.mock("@/lib/pdf/generate-document-pdf", () => ({ generateDevisPdfBuffer: vi.fn(() => Buffer.from("%PDF-1.4 devis fictif")) }));

// IA simulée : le vrai code d'extraction et de transcription s'exécute,
// avec des modèles du SDK qui renvoient des réponses scriptées.
vi.mock("@/lib/ai/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/config")>();
  const { MockLanguageModelV4, MockTranscriptionModelV4 } = await import("ai/test");
  const extractionModel = new MockLanguageModelV4({
    doGenerate: async (options) => {
      h.extractionPrompts.push(JSON.stringify(options.prompt));
      const next = h.extractions.shift();
      if (!next) throw new Error("Appel IA d'extraction inattendu (aucune réponse scriptée)");
      return {
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 100, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 50, text: undefined, reasoning: undefined },
        },
        content: [{ type: "text", text: JSON.stringify(next) }],
        warnings: [],
      };
    },
  });
  const transcriptionModel = new MockTranscriptionModelV4({
    doGenerate: (async () => {
      const next = h.transcriptions.shift();
      if (!next) throw new Error("Appel de transcription inattendu");
      return next;
    }) as never,
  });
  return {
    ...actual,
    isAiConfigured: () => true,
    getWhatsappExtractionModel: () => extractionModel,
    getWhatsappTranscriptionModel: () => transcriptionModel,
  };
});

// Média entrant simulé, uniquement pour les tests de vocal transcrit : sinon
// le vrai module (bloqué en mode simulation) est utilisé.
vi.mock("@/lib/whatsapp/media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/media")>();
  return {
    ...actual,
    getMediaMetadata: async (mediaId: string) =>
      h.media ? { url: `https://media.invalid/${mediaId}`, mimeType: h.media.mimeType, fileSizeBytes: 12 } : actual.getMediaMetadata(mediaId),
    downloadMediaBuffer: async (url: string, max?: number) =>
      h.media ? Buffer.from("audio-fictif") : actual.downloadMediaBuffer(url, max),
  };
});

import { fakePrisma } from "@/tests/support/fake-prisma";
import { POST as webhookPost } from "@/app/api/whatsapp/webhook/route";
import { processWhatsappJob } from "@/lib/whatsapp/agent";
import { clearSimulatedOutbox, getSimulatedOutbox } from "@/lib/outbound/mode";

// ── Données de test (toutes fictives) ────────────────────────────────────
const SECRET = "test-whatsapp-app-secret";
const FROM_A = "33611111111"; // artisan A (+33 6 11 11 11 11)
const FROM_B = "33633333333"; // artisan B
const CLIENT_PHONE = "06 22 22 22 22";

let artisanA: Record<string, unknown>;
let artisanB: Record<string, unknown>;
let fetchSpy: MockInstance<typeof fetch>;
let wamid = 0;
const savedSecret = process.env.WHATSAPP_APP_SECRET;

function line(description: string, montant: number | null, ligneCibleIndex: number | null = null): RawExtractedLine {
  return { ligneCibleIndex, description, quantite: null, unite: null, prixUnitaire: null, montant, tva: null };
}

function ext(p: Omit<Partial<RawExtraction>, "client"> & { client?: Partial<RawExtraction["client"]> } = {}): RawExtraction {
  return {
    intent: "devis",
    reponseConfirmation: null,
    objet: null,
    descriptionTravaux: null,
    lignes: [],
    montantMentionne: null,
    notes: null,
    plusieursDevisDetectes: false,
    ambiguites: [],
    ...p,
    client: { nom: null, telephone: null, email: null, adresse: null, ...p.client },
  };
}

const OUI = ext({ intent: "confirmation", reponseConfirmation: "oui" });
const NON = ext({ intent: "confirmation", reponseConfirmation: "non" });
const DEVIS_MARTIN = ext({
  client: { nom: "Mme Martin", telephone: CLIENT_PHONE },
  objet: "Peinture salon",
  lignes: [line("Peinture salon", 1200)],
});

type Incoming = { type: "text"; body: string } | { type: "audio"; mediaId: string };
const text = (body: string): Incoming => ({ type: "text", body });

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

async function flush(): Promise<void> {
  while (h.pending.length > 0) await Promise.all(h.pending.splice(0));
}

// Livre un message comme le ferait Meta (payload signé), puis attend la fin
// du traitement asynchrone déclenché par waitUntil.
async function deliver(from: string, msg: Incoming, opts: { id?: string; secret?: string } = {}) {
  const id = opts.id ?? `wamid.test.${++wamid}`;
  const message =
    msg.type === "text"
      ? { id, from, type: "text", timestamp: "1700000000", text: { body: msg.body } }
      : { id, from, type: "audio", timestamp: "1700000000", audio: { id: msg.mediaId, mime_type: "audio/ogg; codecs=opus" } };
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba_test", changes: [{ field: "messages", value: { metadata: { display_phone_number: "33100000000" }, messages: [message] } }] }],
  });
  const res = await webhookPost(
    new Request("http://localhost/api/whatsapp/webhook", {
      method: "POST",
      body,
      headers: { "x-hub-signature-256": sign(body, opts.secret) },
    })
  );
  await flush();
  return { res, id };
}

const rows = (model: string) => fakePrisma.rows(model) as Record<string, any>[];
const repliesTo = (userId: unknown) => {
  const convIds = new Set(rows("whatsappConversation").filter((c) => c.userId === userId).map((c) => c.id));
  return rows("whatsappMessage").filter((m) => m.direction === "out" && convIds.has(m.conversationId)).map((m) => m.content as string);
};
const lastReply = (userId: unknown = artisanA.id) => repliesTo(userId).at(-1) ?? "";
const conversationOf = (userId: unknown) => rows("whatsappConversation").find((c) => c.userId === userId)!;
const documentsSent = () => getSimulatedOutbox().filter((e) => e.channel === "whatsapp.document");

// Raccourci : amène la conversation d'A jusqu'au devis créé (en attente
// de confirmation d'envoi).
async function createDevisForMartin() {
  h.extractions.push(DEVIS_MARTIN, OUI);
  await deliver(FROM_A, text("Devis pour Mme Martin 06 22 22 22 22, peinture salon 1200 €"));
  await deliver(FROM_A, text("oui"));
}

beforeEach(() => {
  fakePrisma.reset();
  clearSimulatedOutbox();
  h.pending.length = 0;
  h.extractions.length = 0;
  h.extractionPrompts.length = 0;
  h.transcriptions.length = 0;
  h.media = null;
  process.env.WHATSAPP_APP_SECRET = SECRET;
  delete process.env.OUTBOUND_MODE;

  artisanA = fakePrisma.seed("user", {
    clerkId: "clerk_A", email: "artisan-a@example.com", companyName: "Artisan A",
    phone: "06 11 11 11 11", stripeSubscriptionId: "sub_A", subscriptionStatus: "active",
  });
  artisanB = fakePrisma.seed("user", {
    clerkId: "clerk_B", email: "artisan-b@example.com", companyName: "Artisan B",
    phone: "06 33 33 33 33", stripeSubscriptionId: "sub_B", subscriptionStatus: "active",
  });

  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("APPEL RÉSEAU INTERDIT dans les tests");
  });
  for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {});
});

afterEach(() => {
  // Invariant de TOUS les tests : aucun appel réseau réel.
  expect(fetchSpy).not.toHaveBeenCalled();
  if (savedSecret === undefined) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = savedSecret;
  vi.restoreAllMocks();
});

describe("parcours nominal", () => {
  it("nouveau client, demande complète : récapitulatif → création → envoi simulé du devis", async () => {
    h.extractions.push(DEVIS_MARTIN, OUI, OUI);

    const first = await deliver(FROM_A, text("Devis pour Mme Martin 06 22 22 22 22, peinture salon 1200 €"));
    expect(first.res.status).toBe(200);
    expect(lastReply()).toMatch(/Voici le récapitulatif du devis/);
    expect(lastReply()).toMatch(/Mme Martin/);
    expect(conversationOf(artisanA.id).state).toBe("awaiting_creation_confirmation");
    expect(rows("devis")).toHaveLength(0);

    await deliver(FROM_A, text("oui"));
    expect(lastReply()).toMatch(/a été créé/);
    const [client] = rows("client");
    expect(client).toMatchObject({ userId: artisanA.id, name: "Mme Martin", phone: CLIENT_PHONE });
    const [devis] = rows("devis");
    expect(devis).toMatchObject({ userId: artisanA.id, clientId: client.id, status: "brouillon", totalHT: 1200, totalTTC: 1440 });
    expect(rows("devisLine")).toHaveLength(1);
    expect(documentsSent()).toHaveLength(0);

    await deliver(FROM_A, text("oui, envoie-le"));
    expect(lastReply()).toMatch(/a bien été envoyé à Mme Martin/);
    expect(rows("devis")[0]).toMatchObject({ status: "envoye" });
    expect(rows("devis")[0].sentAt).toBeInstanceOf(Date);
    expect(rows("whatsappSend")[0]).toMatchObject({ status: "success" });
    expect(rows("whatsappSend")[0].externalMessageId).toMatch(/^sim_wamid_/);
    expect(conversationOf(artisanA.id)).toMatchObject({ state: "idle", pendingDevis: null });

    // Envoi au CLIENT (et non à l'artisan) : upload + document, simulés.
    expect(getSimulatedOutbox().filter((e) => e.channel === "whatsapp.media_upload")).toHaveLength(1);
    expect(documentsSent()).toEqual([expect.objectContaining({ to: "********2222" })]);
    // 3 réponses à l'artisan, toutes simulées.
    expect(getSimulatedOutbox().filter((e) => e.channel === "whatsapp.text" && e.to === "********1111")).toHaveLength(3);

    expect(h.extractions).toHaveLength(0);
    expect(rows("aiUsageEvent")).toHaveLength(3);
    expect(rows("whatsappJob").every((j) => j.status === "done")).toBe(true);
  });

  it("client existant : réutilisé, aucun doublon créé", async () => {
    const existing = fakePrisma.seed("client", { userId: artisanA.id, name: "Jean Dupont", phone: "06 44 44 44 44" });
    h.extractions.push(ext({ client: { nom: "Jean Dupont" }, objet: "Plomberie", lignes: [line("Remplacement chauffe-eau", 900)] }), OUI);

    await deliver(FROM_A, text("Devis pour Jean Dupont, remplacement chauffe-eau 900 €"));
    await deliver(FROM_A, text("oui"));

    expect(lastReply()).toMatch(/a été créé/);
    expect(rows("client")).toHaveLength(1);
    expect(rows("devis")[0].clientId).toBe(existing.id);
  });

  it("demande incomplète : clarification, aucun devis tant que le prix manque, puis complétion", async () => {
    h.extractions.push(
      ext({ client: { nom: "M. Bernard", telephone: CLIENT_PHONE }, objet: "Carrelage", lignes: [line("Carrelage cuisine", null)] }),
      OUI,
      ext({ lignes: [line("Carrelage cuisine", 800, 0)] }),
      OUI
    );

    await deliver(FROM_A, text("Devis pour M. Bernard, carrelage cuisine"));
    expect(lastReply()).toMatch(/Quelles prestations et à quel prix/);
    expect(conversationOf(artisanA.id).state).toBe("collecting");

    await deliver(FROM_A, text("oui"));
    expect(lastReply()).toMatch(/Il me manque encore des informations/);
    expect(rows("devis")).toHaveLength(0);

    await deliver(FROM_A, text("800 € le carrelage"));
    expect(lastReply()).toMatch(/Voici le récapitulatif/);

    await deliver(FROM_A, text("oui"));
    expect(rows("devis")).toEqual([expect.objectContaining({ totalHT: 800, status: "brouillon" })]);
  });
});

describe("refus", () => {
  it("refus de la création : rien n'est créé, le brouillon reste en cours", async () => {
    h.extractions.push(DEVIS_MARTIN, NON);
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"));
    await deliver(FROM_A, text("non"));

    expect(lastReply()).toMatch(/je ne crée rien/);
    expect(rows("devis")).toHaveLength(0);
    expect(rows("client")).toHaveLength(0);
    expect(conversationOf(artisanA.id).state).toBe("collecting");
  });

  it("refus de l'envoi : le devis reste créé en brouillon, aucun document envoyé", async () => {
    await createDevisForMartin();
    h.extractions.push(NON);
    await deliver(FROM_A, text("non pas maintenant"));

    expect(lastReply()).toMatch(/je n'envoie rien/);
    expect(rows("devis")[0].status).toBe("brouillon");
    expect(rows("whatsappSend")).toHaveLength(0);
    expect(documentsSent()).toHaveLength(0);
  });
});

describe("messages vocaux", () => {
  it("vocal transcrit (média et Whisper simulés) : traité comme un message texte", async () => {
    h.media = { mimeType: "audio/ogg; codecs=opus" };
    const said = "Devis pour Madame Martin, peinture du salon, mille deux cents euros";
    h.transcriptions.push({
      text: said, segments: [], language: "fr", durationInSeconds: 6, warnings: [],
      response: { timestamp: new Date(), modelId: "mock-whisper", headers: {} },
    });
    h.extractions.push(DEVIS_MARTIN);

    await deliver(FROM_A, { type: "audio", mediaId: "media_vocal_1" });

    expect(lastReply()).toMatch(/Voici le récapitulatif/);
    const incoming = rows("whatsappMessage").find((m) => m.direction === "in")!;
    expect(incoming).toMatchObject({ type: "audio", transcriptionStatus: "done", transcription: said, extractionStatus: "done" });
    expect(h.extractionPrompts[0]).toContain("mille deux cents euros");
  });

  it("vocal en mode simulation pur : média bloqué → réponse claire, escalade, aucun appel IA", async () => {
    await deliver(FROM_A, { type: "audio", mediaId: "media_vocal_2" });

    expect(lastReply()).toMatch(/récupérer votre message vocal/);
    expect(rows("notification")).toEqual([expect.objectContaining({ userId: artisanA.id, type: "whatsapp_escalade" })]);
    expect(h.extractionPrompts).toHaveLength(0);
    expect(rows("aiUsageEvent")).toHaveLength(0);
    expect(rows("whatsappJob")[0].status).toBe("done");
  });
});

describe("messages reçus plusieurs fois", () => {
  it("même message livré deux fois par Meta : un seul message, un seul job, un seul appel IA, une seule réponse", async () => {
    h.extractions.push(DEVIS_MARTIN);
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"), { id: "wamid.dup" });
    const second = await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"), { id: "wamid.dup" });

    expect(second.res.status).toBe(200);
    expect(rows("whatsappMessage").filter((m) => m.direction === "in")).toHaveLength(1);
    expect(rows("whatsappJob")).toHaveLength(1);
    expect(h.extractionPrompts).toHaveLength(1);
    expect(repliesTo(artisanA.id)).toHaveLength(1);
  });

  it("[régression] message enregistré mais job non créé (erreur base), puis relivré par Meta : il est bien traité", async () => {
    h.extractions.push(DEVIS_MARTIN);
    fakePrisma.failNext("whatsappJob.create", new Error("Base momentanément indisponible"));

    await expect(deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"), { id: "wamid.lost" })).rejects.toThrow(/indisponible/);
    expect(rows("whatsappJob")).toHaveLength(0);

    // Meta relivre le même message après l'erreur 500.
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"), { id: "wamid.lost" });

    expect(rows("whatsappMessage").filter((m) => m.direction === "in")).toHaveLength(1);
    expect(rows("whatsappJob")).toEqual([expect.objectContaining({ status: "done" })]);
    expect(lastReply()).toMatch(/Voici le récapitulatif/);
  });

  it("[régression] reprise d'un job « oui » de création (réponse non enregistrée) : le devis n'est JAMAIS envoyé sans confirmation", async () => {
    h.extractions.push(DEVIS_MARTIN, OUI);
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"));
    // La création réussit, mais l'enregistrement de la réponse échoue → job en échec.
    fakePrisma.failNext("whatsappMessage.create", new Error("Coupure réseau base"), (a) => (a as any).data.direction === "out");
    await deliver(FROM_A, text("oui"));
    const failedJob = rows("whatsappJob").find((j) => j.status === "failed")!;
    expect(failedJob).toBeDefined();
    expect(rows("devis")).toHaveLength(1);

    // Reprise par le cron : même message « oui » (déjà extrait, rejoué depuis le checkpoint).
    expect(await processWhatsappJob(failedJob.id)).toBe(true);

    expect(documentsSent()).toHaveLength(0);
    expect(rows("devis")[0].status).toBe("brouillon");
    expect(lastReply()).toMatch(/a été créé/);
    expect(h.extractionPrompts).toHaveLength(2); // aucun nouvel appel IA lors de la reprise
  });

  it("reprise du job de confirmation d'envoi après succès : aucun second document", async () => {
    await createDevisForMartin();
    h.extractions.push(OUI);
    fakePrisma.failNext("whatsappMessage.create", new Error("Coupure réseau base"), (a) => (a as any).data.direction === "out");
    await deliver(FROM_A, text("oui"));
    const failedJob = rows("whatsappJob").find((j) => j.status === "failed")!;
    expect(documentsSent()).toHaveLength(1);

    await processWhatsappJob(failedJob.id);

    expect(documentsSent()).toHaveLength(1);
    expect(lastReply()).toMatch(/a bien été envoyé/);
  });
});

describe("après un premier devis envoyé", () => {
  it("[régression] un nouveau devis peut être préparé, créé et envoyé dans la même conversation", async () => {
    await createDevisForMartin();
    h.extractions.push(OUI);
    await deliver(FROM_A, text("oui"));
    expect(rows("devis")[0].status).toBe("envoye");

    h.extractions.push(
      ext({ client: { nom: "M. Petit", telephone: "06 55 55 55 55" }, objet: "Électricité", lignes: [line("Tableau électrique", 650)] }),
      OUI,
      OUI
    );
    await deliver(FROM_A, text("Nouveau devis pour M. Petit 06 55 55 55 55, tableau électrique 650 €"));
    expect(lastReply()).toMatch(/Voici le récapitulatif/);
    expect(lastReply()).toMatch(/M\. Petit/);

    await deliver(FROM_A, text("oui"));
    await deliver(FROM_A, text("oui"));

    const devis = rows("devis");
    expect(devis).toHaveLength(2);
    expect(devis.map((d) => d.status)).toEqual(["envoye", "envoye"]);
    expect(new Set(devis.map((d) => d.number)).size).toBe(2);
    expect(documentsSent().map((d) => d.to)).toEqual(["********2222", "********5555"]);
  });
});

describe("erreurs de création", () => {
  it("[régression] client identifié puis supprimé : réponse claire, aucun devis, et nouvelle confirmation possible", async () => {
    fakePrisma.seed("client", { userId: artisanA.id, name: "Jean Dupont", phone: "06 44 44 44 44" });
    h.extractions.push(ext({ client: { nom: "Jean Dupont" }, objet: "Plomberie", lignes: [line("Chauffe-eau", 900)] }), OUI, OUI);
    await deliver(FROM_A, text("Devis pour Jean Dupont, chauffe-eau 900 €"));

    fakePrisma.store.client = []; // supprimé entre-temps depuis l'interface web

    await deliver(FROM_A, text("oui"));
    expect(lastReply()).toMatch(/n'ai pas pu créer le devis/);
    expect(rows("devis")).toHaveLength(0);
    expect(rows("whatsappJob").every((j) => j.status === "done")).toBe(true);
    expect(conversationOf(artisanA.id).state).toBe("awaiting_creation_confirmation");

    await deliver(FROM_A, text("oui"));
    expect(lastReply()).toMatch(/a été créé/);
    expect(rows("client")).toEqual([expect.objectContaining({ name: "Jean Dupont", userId: artisanA.id })]);
    expect(rows("devis")).toHaveLength(1);
  });

  it("échec transitoire pendant la création du devis : tout est annulé (aucun client orphelin), puis la reprise crée exactement un client et un devis", async () => {
    h.extractions.push(DEVIS_MARTIN, OUI);
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"));
    fakePrisma.failNext("devis.create", new Error("Timeout base de données"));

    await deliver(FROM_A, text("oui"));
    expect(rows("client")).toHaveLength(0);
    expect(rows("devis")).toHaveLength(0);
    expect(conversationOf(artisanA.id).state).toBe("awaiting_creation_confirmation");
    const failedJob = rows("whatsappJob").find((j) => j.status === "failed")!;
    expect(failedJob.lastError).toMatch(/Timeout/);

    await processWhatsappJob(failedJob.id);

    expect(rows("client")).toHaveLength(1);
    expect(rows("devis")).toHaveLength(1);
    expect(lastReply()).toMatch(/a été créé/);
    expect(h.extractionPrompts).toHaveLength(2);
  });
});

describe("isolation entre comptes Gestly", () => {
  it("un client homonyme d'un autre artisan n'est jamais utilisé ni modifié", async () => {
    const otherTenantClient = fakePrisma.seed("client", { userId: artisanB.id, name: "Jean Dupont", phone: "06 44 44 44 44" });
    h.extractions.push(ext({ client: { nom: "Jean Dupont", telephone: CLIENT_PHONE }, objet: "Plomberie", lignes: [line("Chauffe-eau", 900)] }), OUI);

    await deliver(FROM_A, text("Devis pour Jean Dupont, chauffe-eau 900 €"));
    await deliver(FROM_A, text("oui"));

    const clientsA = rows("client").filter((c) => c.userId === artisanA.id);
    expect(clientsA).toHaveLength(1);
    expect(clientsA[0].id).not.toBe(otherTenantClient.id);
    expect(rows("devis")[0]).toMatchObject({ userId: artisanA.id, clientId: clientsA[0].id });
    expect(rows("client").find((c) => c.id === otherTenantClient.id)).toEqual(expect.objectContaining({ userId: artisanB.id, name: "Jean Dupont" }));
  });

  it("deux artisans ont des conversations et brouillons séparés", async () => {
    h.extractions.push(DEVIS_MARTIN, OUI);
    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"));
    await deliver(FROM_B, text("oui"));

    expect(rows("whatsappConversation")).toHaveLength(2);
    expect(conversationOf(artisanA.id).state).toBe("awaiting_creation_confirmation");
    expect(rows("devis")).toHaveLength(0);
    expect(lastReply(artisanB.id)).toMatch(/Il me manque encore des informations/);
  });

  it("numéro inconnu : rien n'est créé, aucun appel IA", async () => {
    await deliver("33699999999", text("Bonjour, je voudrais un devis"));

    expect(rows("whatsappConversation")).toHaveLength(0);
    expect(rows("whatsappMessage")).toHaveLength(0);
    expect(h.extractionPrompts).toHaveLength(0);
  });

  it("[régression] numéro partagé par deux comptes Gestly : message ignoré, jamais attribué au hasard", async () => {
    fakePrisma.seed("user", {
      clerkId: "clerk_A2", email: "autre-compte@example.com", companyName: "Autre compte",
      phone: "+33 6 11 11 11 11", stripeSubscriptionId: "sub_A2", subscriptionStatus: "active",
    });

    await deliver(FROM_A, text("Devis pour Mme Martin, peinture 1200 €"));

    expect(rows("whatsappConversation")).toHaveLength(0);
    expect(rows("whatsappMessage")).toHaveLength(0);
    expect(h.extractionPrompts).toHaveLength(0);
  });

  it("signature Meta invalide : 403, rien n'est enregistré", async () => {
    const { res } = await deliver(FROM_A, text("Devis"), { secret: "mauvais-secret" });

    expect(res.status).toBe(403);
    expect(rows("whatsappMessage")).toHaveLength(0);
  });
});
