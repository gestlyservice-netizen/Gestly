import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WhatsappMessage } from "@prisma/client";

const updateMock = vi.fn();
const updateManyMock = vi.fn();
const findUniqueOrThrowMock = vi.fn();
const getMediaMetadataMock = vi.fn();
const downloadMediaBufferMock = vi.fn();
const transcribeAudioMock = vi.fn();
const escalateToArtisanMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappMessage: {
      update: (...args: unknown[]) => updateMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
      findUniqueOrThrow: (...args: unknown[]) => findUniqueOrThrowMock(...args),
    },
  },
}));

vi.mock("@/lib/whatsapp/media", () => ({
  getMediaMetadata: (...args: unknown[]) => getMediaMetadataMock(...args),
  downloadMediaBuffer: (...args: unknown[]) => downloadMediaBufferMock(...args),
  MediaTooLargeError: class MediaTooLargeError extends Error {},
}));

vi.mock("@/lib/whatsapp/transcription", () => ({
  transcribeAudio: (...args: unknown[]) => transcribeAudioMock(...args),
}));

vi.mock("@/lib/whatsapp/escalation", () => ({
  escalateToArtisan: (...args: unknown[]) => escalateToArtisanMock(...args),
}));

vi.mock("@/lib/ai/config", () => ({
  getWhatsappTranscriptionModel: () => "mock-transcription-model",
}));

import { resolveVoiceMessageText } from "@/lib/whatsapp/voice-message";

function pendingMessage(overrides: Partial<WhatsappMessage> = {}): WhatsappMessage {
  return {
    id: "msg_1",
    mediaId: "media_1",
    transcriptionStatus: "pending",
    transcription: null,
    ...overrides,
  } as unknown as WhatsappMessage;
}

beforeEach(() => {
  updateMock.mockReset();
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  findUniqueOrThrowMock.mockReset();
  getMediaMetadataMock.mockReset();
  downloadMediaBufferMock.mockReset();
  transcribeAudioMock.mockReset();
  escalateToArtisanMock.mockReset();
});

describe("resolveVoiceMessageText — idempotence (test requis #9)", () => {
  it("un message déjà transcrit (transcriptionStatus=done) ne relance jamais de transcription réelle", async () => {
    const message = pendingMessage({ transcriptionStatus: "done", transcription: "devis peinture 500 euros" });

    const result = await resolveVoiceMessageText(message, "user_1");

    expect(result).toEqual({ kind: "transcribed", text: "devis peinture 500 euros" });
    expect(transcribeAudioMock).not.toHaveBeenCalled();
    expect(updateManyMock).not.toHaveBeenCalled();
  });

  it("un retry de job APRÈS un succès complet (relu depuis la DB) ne rappelle pas non plus la transcription", async () => {
    // Simule : le job a été relu (nouvel objet message), mais la ligne DB
    // porte déjà transcriptionStatus="done" suite à une tentative précédente.
    const message = pendingMessage({ transcriptionStatus: "done", transcription: "texte déjà transcrit" });
    await resolveVoiceMessageText(message, "user_1");
    await resolveVoiceMessageText(message, "user_1");

    expect(transcribeAudioMock).not.toHaveBeenCalled();
  });
});

describe("resolveVoiceMessageText — échec définitif -> escalade (test requis #16)", () => {
  it("média introuvable côté Meta -> échec définitif, une seule escalade", async () => {
    getMediaMetadataMock.mockRejectedValue(new Error("404 média expiré"));

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result).toEqual({ kind: "failed", reason: "media_not_found" });
    expect(escalateToArtisanMock).toHaveBeenCalledTimes(1);
    expect(escalateToArtisanMock).toHaveBeenCalledWith("user_1", "transcription_echec", "msg_1", expect.any(String));
    // Définitif : jamais repassé "pending" pour un retry automatique.
    expect(updateMock).toHaveBeenCalledWith({ where: { id: "msg_1" }, data: { transcriptionStatus: "failed" } });
  });

  it("identifiant de média manquant -> échec définitif immédiat, escalade", async () => {
    const result = await resolveVoiceMessageText(pendingMessage({ mediaId: null }), "user_1");

    expect(result).toEqual({ kind: "failed", reason: "media_not_found" });
    expect(getMediaMetadataMock).not.toHaveBeenCalled();
    expect(escalateToArtisanMock).toHaveBeenCalledTimes(1);
  });

  it("une erreur transitoire (téléchargement) ne déclenche PAS d'escalade et repasse le message à pending pour retry", async () => {
    getMediaMetadataMock.mockResolvedValue({ url: "https://meta/media", mimeType: "audio/ogg", fileSizeBytes: 1000 });
    downloadMediaBufferMock.mockRejectedValue(new Error("timeout réseau"));

    await expect(resolveVoiceMessageText(pendingMessage(), "user_1")).rejects.toThrow("timeout réseau");

    expect(escalateToArtisanMock).not.toHaveBeenCalled();
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: "msg_1", transcriptionStatus: "processing" },
      data: { transcriptionStatus: "pending" },
    });
  });
});
