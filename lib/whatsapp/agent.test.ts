import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WhatsappMessage } from "@prisma/client";

const disableArtisanBotMock = vi.fn();
const enableArtisanBotMock = vi.fn();
const isAiQuotaExceededMock = vi.fn();
const processTextMessageMock = vi.fn();
const resolveVoiceMessageTextMock = vi.fn();

vi.mock("@/lib/whatsapp/artisan-optout", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp/artisan-optout")>(
    "@/lib/whatsapp/artisan-optout"
  );
  return {
    ...actual,
    disableArtisanBot: (...args: unknown[]) => disableArtisanBotMock(...args),
    enableArtisanBot: (...args: unknown[]) => enableArtisanBotMock(...args),
  };
});

vi.mock("@/lib/ai/usage", () => ({
  isAiQuotaExceeded: (...args: unknown[]) => isAiQuotaExceededMock(...args),
}));

vi.mock("@/lib/whatsapp/conversation-turn", () => ({
  processTextMessage: (...args: unknown[]) => processTextMessageMock(...args),
}));

vi.mock("@/lib/whatsapp/voice-message", () => ({
  resolveVoiceMessageText: (...args: unknown[]) => resolveVoiceMessageTextMock(...args),
}));

// prisma/send non utilisés par buildReply lui-même, mais importés
// transitivement par agent.ts (processWhatsappJob) : mock minimal pour que
// le module se charge sans connexion réelle.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/whatsapp/job-queue", () => ({ claimJob: vi.fn() }));
vi.mock("@/lib/whatsapp/send", () => ({ sendWhatsappText: vi.fn() }));

import { buildReply } from "@/lib/whatsapp/agent";

function textMessage(content: string): WhatsappMessage {
  return { type: "text", content } as unknown as WhatsappMessage;
}
function audioMessage(): WhatsappMessage {
  return { type: "audio", content: "" } as unknown as WhatsappMessage;
}

beforeEach(() => {
  disableArtisanBotMock.mockReset();
  enableArtisanBotMock.mockReset();
  isAiQuotaExceededMock.mockReset().mockResolvedValue(false);
  processTextMessageMock.mockReset().mockResolvedValue("réponse IA");
  resolveVoiceMessageTextMock.mockReset();
});

describe("buildReply — ordre des garde-fous (étape 8)", () => {
  // Test requis #1
  it("STOP explicite désactive le bot et répond une seule fois", async () => {
    const reply = await buildReply(textMessage("STOP"), "conv_1", "user_1", false);
    expect(disableArtisanBotMock).toHaveBeenCalledWith("conv_1");
    expect(reply).toContain("désactivé");
    expect(processTextMessageMock).not.toHaveBeenCalled();
  });

  it("STOP reçu alors que déjà opted-out ne redésactive pas et reste silencieux (pas de double confirmation)", async () => {
    const reply = await buildReply(textMessage("STOP"), "conv_1", "user_1", true);
    expect(disableArtisanBotMock).not.toHaveBeenCalled();
    expect(reply).toBeNull();
  });

  // Test requis #2
  it("conversation opted-out + message ordinaire -> silence total, aucun appel IA", async () => {
    const reply = await buildReply(textMessage("Bonjour, un devis pour M. Martin"), "conv_1", "user_1", true);
    expect(reply).toBeNull();
    expect(processTextMessageMock).not.toHaveBeenCalled();
    expect(resolveVoiceMessageTextMock).not.toHaveBeenCalled();
    expect(isAiQuotaExceededMock).not.toHaveBeenCalled();
  });

  it("conversation opted-out + message vocal -> silence total, aucune transcription", async () => {
    const reply = await buildReply(audioMessage(), "conv_1", "user_1", true);
    expect(reply).toBeNull();
    expect(resolveVoiceMessageTextMock).not.toHaveBeenCalled();
  });

  // Test requis #3
  it("START réactive une conversation opted-out", async () => {
    const reply = await buildReply(textMessage("START"), "conv_1", "user_1", true);
    expect(enableArtisanBotMock).toHaveBeenCalledWith("conv_1");
    expect(reply).toContain("réactivé");
    expect(processTextMessageMock).not.toHaveBeenCalled();
  });

  it("START reçu hors opt-out n'est pas une commande (rien à réactiver) : traité comme message normal", async () => {
    await buildReply(textMessage("START"), "conv_1", "user_1", false);
    expect(enableArtisanBotMock).not.toHaveBeenCalled();
    expect(processTextMessageMock).toHaveBeenCalledWith("conv_1", "user_1", "START");
  });

  // Test requis #4
  it("'stop' au milieu d'une phrase métier n'est jamais interprété comme un opt-out", async () => {
    await buildReply(textMessage("il faut stopper le chantier avant vendredi"), "conv_1", "user_1", false);
    expect(disableArtisanBotMock).not.toHaveBeenCalled();
    expect(processTextMessageMock).toHaveBeenCalledTimes(1);
  });

  // Test requis #11 et #12 (partiel — cf. rapport pour la portée exacte du #12)
  it("plafond IA atteint -> aucun nouvel appel IA, réponse claire renvoyée", async () => {
    isAiQuotaExceededMock.mockResolvedValue(true);
    const reply = await buildReply(textMessage("Devis pour M. Dupont, peinture, 500€"), "conv_1", "user_1", false);
    expect(processTextMessageMock).not.toHaveBeenCalled();
    expect(reply).toContain("limite");
  });

  it("plafond IA atteint bloque aussi un message vocal (aucune transcription)", async () => {
    isAiQuotaExceededMock.mockResolvedValue(true);
    await buildReply(audioMessage(), "conv_1", "user_1", false);
    expect(resolveVoiceMessageTextMock).not.toHaveBeenCalled();
  });

  it("message texte normal, quota disponible -> délègue à processTextMessage", async () => {
    const reply = await buildReply(textMessage("Devis pour M. Dupont"), "conv_1", "user_1", false);
    expect(processTextMessageMock).toHaveBeenCalledWith("conv_1", "user_1", "Devis pour M. Dupont");
    expect(reply).toBe("réponse IA");
  });

  it("message vocal transcrit -> traité comme un message texte ordinaire ensuite", async () => {
    resolveVoiceMessageTextMock.mockResolvedValue({ kind: "transcribed", text: "devis peinture 500 euros" });
    await buildReply(audioMessage(), "conv_1", "user_1", false);
    expect(processTextMessageMock).toHaveBeenCalledWith("conv_1", "user_1", "devis peinture 500 euros");
  });
});
