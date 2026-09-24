import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";

const recordAiUsageMock = vi.fn();

vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsageMock(...args),
}));

import { extractDevisInfo } from "@/lib/whatsapp/extraction";
import { emptyPendingDevis } from "@/lib/whatsapp/pending-devis";

// Toute clé listée dans "properties" à un niveau d'objet donné du JSON
// Schema doit aussi apparaître dans "required" à ce même niveau : c'est
// exactement la contrainte imposée par le mode structured output STRICT
// d'OpenAI ("'required' is required to... including every key in
// properties"). Un champ Zod avec .default(...) est considéré "optional"
// par le convertisseur JSON Schema interne du SDK (schema.isOptional() ===
// true pour ZodDefault) et disparaît alors de "required" — ce qui fait
// échouer l'appel réel à l'API (découvert en Phase 2 de la validation
// pré-production, 2026-09, sur les champs lignes/plusieursDevisDetectes/
// ambiguites). Cette fonction détecte tout futur .default() réintroduit par
// erreur, sans avoir besoin d'un vrai appel réseau.
function findMissingRequiredKeys(schema: unknown, path = "$"): string[] {
  if (!schema || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const violations: string[] = [];

  if (node.type === "object" && node.properties && typeof node.properties === "object") {
    const propertyKeys = Object.keys(node.properties as Record<string, unknown>);
    const required = new Set((node.required as string[] | undefined) ?? []);
    for (const key of propertyKeys) {
      if (!required.has(key)) violations.push(`${path}.${key}`);
    }
    for (const key of propertyKeys) {
      violations.push(...findMissingRequiredKeys((node.properties as Record<string, unknown>)[key], `${path}.${key}`));
    }
  }
  if (node.items) violations.push(...findMissingRequiredKeys(node.items, `${path}[]`));

  return violations;
}

const VALID_OBJECT = {
  intent: "devis",
  reponseConfirmation: null,
  client: { nom: "M. Dupont", telephone: null, email: null, adresse: null },
  objet: "Peinture salon",
  descriptionTravaux: null,
  lignes: [{ ligneCibleIndex: null, description: "Peinture", quantite: null, unite: null, prixUnitaire: 500, montant: null, tva: null }],
  montantMentionne: null,
  notes: null,
  plusieursDevisDetectes: false,
  ambiguites: [],
};

function baseInput() {
  return {
    userId: "user_1",
    message: "Devis pour M. Dupont, peinture salon, 500€",
    recentHistory: [],
    currentPendingDevis: emptyPendingDevis(),
  };
}

beforeEach(() => {
  recordAiUsageMock.mockReset();
});

// Régression (bug réel trouvé en Phase 2, appel OpenAI réel — cf.
// commentaire sur RawExtractionSchema dans lib/whatsapp/extraction.ts) :
// avec .default() sur lignes/plusieursDevisDetectes/ambiguites, l'appel
// réel à OpenAI échouait systématiquement avec "Invalid schema for
// response_format... Missing 'lignes'". Ce test inspecte le JSON Schema
// RÉELLEMENT construit par le SDK pour cette requête (capturé par le mock,
// sans appel réseau) plutôt que de supposer la forme du schéma.
it("le JSON Schema envoyé au modèle liste chaque propriété dans 'required' (exigence structured output strict d'OpenAI)", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: undefined, reasoning: undefined },
      },
      content: [{ type: "text", text: JSON.stringify(VALID_OBJECT) }],
      warnings: [],
    }),
  });

  await extractDevisInfo(baseInput(), { model });

  const call = model.doGenerateCalls[0] as unknown as { responseFormat?: { schema?: unknown } };
  const violations = findMissingRequiredKeys(call.responseFormat?.schema);
  expect(violations).toEqual([]);
});

describe("extractDevisInfo — comptage d'usage IA", () => {
  // Test requis #8 : un appel réel = un événement comptabilisé.
  it("un appel réussi du premier coup enregistre exactement un événement, avec les tokens fournis", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 55, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 21, text: undefined, reasoning: undefined },
        },
        content: [{ type: "text", text: JSON.stringify(VALID_OBJECT) }],
        warnings: [],
      }),
    });

    const result = await extractDevisInfo(baseInput(), { model });

    expect(result.intent).toBe("devis");
    expect(recordAiUsageMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsageMock).toHaveBeenCalledWith({
      userId: "user_1",
      kind: "extraction",
      success: true,
      inputTokens: 55,
      outputTokens: 21,
      messageId: null,
    });
  });

  it("rattache l'événement au WhatsappMessage d'origine quand messageId est fourni (étape 8bis)", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (): Promise<LanguageModelV4GenerateResult> => ({
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: undefined, reasoning: undefined },
        },
        content: [{ type: "text", text: JSON.stringify(VALID_OBJECT) }],
        warnings: [],
      }),
    });

    await extractDevisInfo(baseInput(), { model, messageId: "msg_42" });

    expect(recordAiUsageMock).toHaveBeenCalledWith(expect.objectContaining({ messageId: "msg_42" }));
  });

  it("un appel qui échoue puis réussit au 2e essai enregistre 2 événements réels distincts (1 échec + 1 succès)", async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async (): Promise<LanguageModelV4GenerateResult> => {
        call += 1;
        if (call === 1) throw new Error("réponse invalide du modèle");
        return {
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: undefined, reasoning: undefined },
          },
          content: [{ type: "text", text: JSON.stringify(VALID_OBJECT) }],
          warnings: [],
        };
      },
    });

    await extractDevisInfo(baseInput(), { model });

    expect(recordAiUsageMock).toHaveBeenCalledTimes(2);
    expect(recordAiUsageMock).toHaveBeenNthCalledWith(1, {
      userId: "user_1",
      kind: "extraction",
      success: false,
      messageId: null,
    });
    expect(recordAiUsageMock.mock.calls[1][0]).toMatchObject({ success: true });
  });

  it("un échec définitif (toutes les tentatives) reste comptabilisé pour chaque appel réel effectué", async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("panne fournisseur");
      },
    });

    await expect(extractDevisInfo(baseInput(), { model })).rejects.toThrow();
    expect(recordAiUsageMock).toHaveBeenCalledTimes(2);
    expect(recordAiUsageMock.mock.calls.every((c) => c[0].success === false)).toBe(true);
  });
});
