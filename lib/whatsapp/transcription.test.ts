import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockTranscriptionModelV4 } from "ai/test";
import { NoTranscriptGeneratedError } from "ai";

const recordAiUsageMock = vi.fn();

vi.mock("@/lib/ai/usage", () => ({
  recordAiUsage: (...args: unknown[]) => recordAiUsageMock(...args),
}));

import { transcribeAudio, TranscriptionError } from "@/lib/whatsapp/transcription";

beforeEach(() => {
  recordAiUsageMock.mockReset();
});

function mockModel(doGenerate: () => Promise<unknown>) {
  return new MockTranscriptionModelV4({ doGenerate: doGenerate as never });
}

describe("transcribeAudio — comptage d'usage IA", () => {
  // Test requis #10 : la transcription est comptabilisée avec sa durée.
  it("enregistre un événement de succès avec la durée audio arrondie", async () => {
    const model = mockModel(async () => ({
      text: "devis peinture salon 500 euros",
      segments: [],
      language: "fr",
      durationInSeconds: 12.6,
      warnings: [],
      response: { timestamp: new Date(), modelId: "mock", headers: {} },
    }));

    const result = await transcribeAudio(new Uint8Array([1, 2, 3]), "user_1", { model });

    expect(result.text).toBe("devis peinture salon 500 euros");
    expect(recordAiUsageMock).toHaveBeenCalledTimes(1);
    expect(recordAiUsageMock).toHaveBeenCalledWith({
      userId: "user_1",
      kind: "transcription",
      success: true,
      audioSeconds: 13, // arrondi de 12.6
    });
  });

  it("ne journalise jamais le texte transcrit, seulement des métadonnées", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const model = mockModel(async () => ({
      text: "informations sensibles du client à ne jamais logguer",
      segments: [],
      language: "fr",
      durationInSeconds: 5,
      warnings: [],
      response: { timestamp: new Date(), modelId: "mock", headers: {} },
    }));

    await transcribeAudio(new Uint8Array([1]), "user_1", { model });

    for (const call of logSpy.mock.calls) {
      expect(String(call.join(" "))).not.toContain("informations sensibles du client");
    }
    logSpy.mockRestore();
  });

  it("un audio sans transcript généré est traité comme un résultat vide, comptabilisé en succès (appel réellement effectué)", async () => {
    const model = mockModel(async () => {
      throw new NoTranscriptGeneratedError({ responses: [{ timestamp: new Date(), modelId: "mock", headers: {} }] });
    });

    const result = await transcribeAudio(new Uint8Array([1]), "user_1", { model });

    expect(result.text).toBe("");
    expect(recordAiUsageMock).toHaveBeenCalledWith({ userId: "user_1", kind: "transcription", success: true, audioSeconds: null });
  });

  it("un échec définitif après retries lève TranscriptionError et comptabilise chaque tentative réelle en échec", async () => {
    const model = mockModel(async () => {
      throw new Error("panne réseau fournisseur");
    });

    await expect(transcribeAudio(new Uint8Array([1]), "user_1", { model })).rejects.toBeInstanceOf(TranscriptionError);
    expect(recordAiUsageMock).toHaveBeenCalledTimes(2);
    expect(recordAiUsageMock.mock.calls.every((c) => c[0].success === false)).toBe(true);
  });
});
