import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";

// Bout-en-bout volontaire (contrairement à extraction-checkpoint.test.ts,
// qui mocke extractDevisInfo) : ce fichier utilise le VRAI
// lib/whatsapp/extraction.ts et le VRAI lib/ai/usage.ts ensemble, pour
// vérifier réellement le test requis #8 — "le quota mensuel n'est pas
// consommé deux fois par le retry d'un même message" — plutôt que de
// déduire cette propriété d'un autre test.

interface FakeMessageRow {
  id: string;
  extractionStatus: string | null;
  extractionResult: unknown;
  extractionModel: string | null;
  updatedAt: Date;
}

const messageRows = new Map<string, FakeMessageRow>();
const aiUsageEvents: Array<{ userId: string; kind: string; success: boolean; messageId: string | null }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappMessage: {
      findUniqueOrThrow: async ({ where: { id } }: { where: { id: string } }) => {
        const row = messageRows.get(id);
        if (!row) throw new Error(`row ${id} not found`);
        return { ...row };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; OR?: Array<Record<string, unknown>> };
        data: Partial<FakeMessageRow>;
      }) => {
        const row = messageRows.get(where.id);
        if (!row) return { count: 0 };
        const matches = (where.OR ?? []).some((cond) => {
          if (cond.extractionStatus === null) return row.extractionStatus === null;
          if (cond.extractionStatus === "processing") {
            const staleBefore = (cond.updatedAt as { lt: Date }).lt;
            return row.extractionStatus === "processing" && row.updatedAt < staleBefore;
          }
          return false;
        });
        if (!matches) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      },
      update: async ({ where: { id }, data }: { where: { id: string }; data: Partial<FakeMessageRow> }) => {
        const row = messageRows.get(id);
        if (!row) throw new Error(`row ${id} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return { ...row };
      },
    },
    aiUsageEvent: {
      create: async ({ data }: { data: { userId: string; kind: string; success: boolean; messageId: string | null } }) => {
        aiUsageEvents.push(data);
        return data;
      },
      count: async ({ where }: { where: { userId: string } }) =>
        aiUsageEvents.filter((e) => e.userId === where.userId).length,
    },
  },
}));

import { resolveExtractionResult } from "@/lib/whatsapp/extraction-checkpoint";
import { getMonthlyAiUsageCount } from "@/lib/ai/usage";
import { emptyPendingDevis } from "@/lib/whatsapp/pending-devis";

const VALID_OBJECT = {
  intent: "devis",
  reponseConfirmation: null,
  client: { nom: "M. Dupont", telephone: null, email: null, adresse: null },
  objet: "Peinture salon",
  descriptionTravaux: null,
  lignes: [],
  montantMentionne: null,
  notes: null,
  plusieursDevisDetectes: false,
  ambiguites: [],
};

function successModel() {
  return new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 5, text: undefined, reasoning: undefined },
      },
      content: [{ type: "text", text: JSON.stringify(VALID_OBJECT) }],
      warnings: [],
    }),
  });
}

beforeEach(() => {
  messageRows.clear();
  aiUsageEvents.length = 0;
});

describe("Test requis #8 — le quota mensuel n'est pas consommé deux fois par le retry d'un même message", () => {
  it("un seul événement AiUsageEvent (donc un seul point de quota) pour un message retenté après succès", async () => {
    messageRows.set("msg_1", {
      id: "msg_1",
      extractionStatus: null,
      extractionResult: null,
      extractionModel: null,
      updatedAt: new Date(),
    });

    const input = {
      userId: "user_1",
      message: "Devis pour M. Dupont, peinture salon",
      recentHistory: [],
      currentPendingDevis: emptyPendingDevis(),
    };

    // Premier traitement (job initial).
    await resolveExtractionResult("msg_1", input, { model: successModel() });
    // Retry du job (ex. l'envoi de la réponse WhatsApp a échoué ensuite) —
    // même messageId, doit réutiliser le checkpoint sans consommer de quota.
    await resolveExtractionResult("msg_1", input, { model: successModel() });
    await resolveExtractionResult("msg_1", input, { model: successModel() });

    expect(aiUsageEvents).toHaveLength(1);
    expect(await getMonthlyAiUsageCount("user_1")).toBe(1);
  });

  it("un nouveau message consomme bien un point de quota supplémentaire (le quota progresse normalement)", async () => {
    messageRows.set("msg_1", { id: "msg_1", extractionStatus: null, extractionResult: null, extractionModel: null, updatedAt: new Date() });
    messageRows.set("msg_2", { id: "msg_2", extractionStatus: null, extractionResult: null, extractionModel: null, updatedAt: new Date() });

    const input = {
      userId: "user_1",
      message: "Devis pour M. Dupont",
      recentHistory: [],
      currentPendingDevis: emptyPendingDevis(),
    };

    await resolveExtractionResult("msg_1", input, { model: successModel() });
    await resolveExtractionResult("msg_1", input, { model: successModel() }); // retry, ne compte pas
    await resolveExtractionResult("msg_2", input, { model: successModel() }); // nouveau message, compte

    expect(await getMonthlyAiUsageCount("user_1")).toBe(2);
  });
});
