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
  describeModel: (model: unknown) => (typeof model === "string" ? model : "mock-transcription-model"),
}));

import { resolveVoiceMessageText, isImplausibleTranscript } from "@/lib/whatsapp/voice-message";

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

// Garde-fou anti-hallucination Whisper (Phase 3, 2026-09) : silence/bruit
// manifeste ne doit jamais être transmis à l'extraction comme s'il s'agissait
// d'un vrai message, mais un vrai message court doit toujours passer.
describe("isImplausibleTranscript — débit de parole implausible (pure)", () => {
  it("signale un texte disproportionné par rapport à la durée réelle (cas réel Phase 3 : bruit blanc 0.3s)", () => {
    expect(isImplausibleTranscript("❤️ par SousTitreur.com", 0.3)).toBe(true);
  });

  it("n'invalide jamais un vrai message court", () => {
    expect(isImplausibleTranscript("Oui", 0.6)).toBe(false);
    expect(isImplausibleTranscript("D'accord", 0.8)).toBe(false);
  });

  it("n'invalide jamais une phrase normale mesurée en Phase 3 (jusqu'à ~18 car/s en français réel)", () => {
    expect(isImplausibleTranscript("Il faut compter 30 mètres carrés de peinture dans la pièce.", 3.38)).toBe(false);
  });

  it("ne juge jamais sur une durée trop imprécise pour être fiable (< 0.3s) — dans le doute, ne rejette pas", () => {
    expect(isImplausibleTranscript("Un texte pourtant long pour une durée quasi nulle ici", 0.1)).toBe(false);
  });

  it("un texte vide n'est jamais 'implausible' (déjà géré séparément par le cas 'empty')", () => {
    expect(isImplausibleTranscript("", 5)).toBe(false);
  });

  it("une durée inconnue (null) n'est jamais évaluée — pas de rejet sans signal fiable", () => {
    expect(isImplausibleTranscript("Un texte quelconque", null)).toBe(false);
  });
});

describe("resolveVoiceMessageText — silence, bruit et vocal suspect (test requis #7 de l'étape 8ter)", () => {
  function setupSuccessfulDownload() {
    getMediaMetadataMock.mockResolvedValue({ url: "https://meta/media", mimeType: "audio/ogg", fileSizeBytes: 5000 });
    downloadMediaBufferMock.mockResolvedValue(Buffer.from("fake-ogg-opus-bytes"));
  }

  it("silence (texte vide) -> reste sur le cas 'empty' existant, jamais 'suspect'", async () => {
    setupSuccessfulDownload();
    transcribeAudioMock.mockResolvedValue({ text: "", durationInSeconds: 2, language: "fr" });

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result).toEqual({ kind: "failed", reason: "empty" });
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ transcriptionStatus: "failed" }) })
    );
  });

  it("bruit -> hallucination Whisper non vide détectée -> 'suspect', jamais transmis comme un vrai message", async () => {
    setupSuccessfulDownload();
    transcribeAudioMock.mockResolvedValue({ text: "❤️ par SousTitreur.com", durationInSeconds: 0.3, language: "fr" });

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result).toEqual({ kind: "failed", reason: "suspect" });
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "msg_1" },
      data: expect.objectContaining({ transcriptionStatus: "failed", durationSeconds: 0 }),
    });
    // Contrairement à media_not_found : l'artisan peut se débrouiller seul
    // (répéter/écrire), aucune escalade interne nécessaire.
    expect(escalateToArtisanMock).not.toHaveBeenCalled();
  });

  it("résultat Whisper suspect (texte disproportionné pour une durée non nulle) -> 'suspect'", async () => {
    setupSuccessfulDownload();
    transcribeAudioMock.mockResolvedValue({
      text: "Ceci est une phrase bien trop longue et détaillée pour tenir dans une seconde",
      durationInSeconds: 1,
      language: "fr",
    });

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result).toEqual({ kind: "failed", reason: "suspect" });
  });

  it("vocal français très court mais valide -> transcrit normalement, jamais rejeté", async () => {
    setupSuccessfulDownload();
    transcribeAudioMock.mockResolvedValue({ text: "Oui", durationInSeconds: 0.6, language: "fr" });

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result).toEqual({ kind: "transcribed", text: "Oui" });
  });

  it("vocal normal -> transcrit normalement", async () => {
    setupSuccessfulDownload();
    transcribeAudioMock.mockResolvedValue({
      text: "Fais-moi un devis pour Jean Dupont, trente mètres carrés de peinture à vingt-cinq euros le mètre carré.",
      durationInSeconds: 6.6,
      language: "fr",
    });

    const result = await resolveVoiceMessageText(pendingMessage(), "user_1");

    expect(result.kind).toBe("transcribed");
  });
});
