import { describe, it, expect, vi, beforeEach } from "vitest";

const conversationFindUniqueMock = vi.fn();
const devisFindUniqueMock = vi.fn();
const settingsFindUniqueMock = vi.fn();
const devisUpdateManyMock = vi.fn();
const conversationUpdateManyMock = vi.fn();

const claimSendAttemptMock = vi.fn();
const markSendFailedMock = vi.fn();
const markSendSuccessMock = vi.fn();

const generateDevisPdfBufferMock = vi.fn();
const uploadWhatsappMediaMock = vi.fn();
const sendWhatsappDocumentMock = vi.fn();
const escalateToArtisanMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappConversation: {
      findUnique: (...args: unknown[]) => conversationFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => conversationUpdateManyMock(...args),
    },
    devis: {
      findUnique: (...args: unknown[]) => devisFindUniqueMock(...args),
      updateMany: (...args: unknown[]) => devisUpdateManyMock(...args),
    },
    settings: {
      findUnique: (...args: unknown[]) => settingsFindUniqueMock(...args),
    },
  },
}));

vi.mock("@/lib/whatsapp/send-claim", () => ({
  claimSendAttempt: (...args: unknown[]) => claimSendAttemptMock(...args),
  markSendFailed: (...args: unknown[]) => markSendFailedMock(...args),
  markSendSuccess: (...args: unknown[]) => markSendSuccessMock(...args),
  MAX_SEND_ATTEMPTS: 5,
}));

vi.mock("@/lib/pdf/generate-document-pdf", () => ({
  generateDevisPdfBuffer: (...args: unknown[]) => generateDevisPdfBufferMock(...args),
}));

vi.mock("@/lib/whatsapp/media", () => ({
  uploadWhatsappMedia: (...args: unknown[]) => uploadWhatsappMediaMock(...args),
}));

vi.mock("@/lib/whatsapp/send", () => ({
  sendWhatsappDocument: (...args: unknown[]) => sendWhatsappDocumentMock(...args),
}));

vi.mock("@/lib/whatsapp/escalation", () => ({
  escalateToArtisan: (...args: unknown[]) => escalateToArtisanMock(...args),
}));

import { sendDevisToClient } from "@/lib/whatsapp/send-devis";

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv_1",
    lastCreatedDevisId: "devis_1",
    state: "awaiting_send_confirmation",
    ...overrides,
  };
}

function devis(overrides: Record<string, unknown> = {}) {
  return {
    id: "devis_1",
    number: "D-0001",
    userId: "user_1",
    status: "brouillon",
    client: { name: "M. Dupont", phone: "+33612345678", whatsappOptOut: false },
    lines: [],
    ...overrides,
  };
}

beforeEach(() => {
  conversationFindUniqueMock.mockReset();
  devisFindUniqueMock.mockReset();
  settingsFindUniqueMock.mockReset().mockResolvedValue(null);
  devisUpdateManyMock.mockReset();
  conversationUpdateManyMock.mockReset();
  claimSendAttemptMock.mockReset();
  markSendFailedMock.mockReset();
  markSendSuccessMock.mockReset();
  generateDevisPdfBufferMock.mockReset().mockReturnValue(Buffer.from("pdf"));
  uploadWhatsappMediaMock.mockReset().mockResolvedValue({ mediaId: "media_1" });
  sendWhatsappDocumentMock.mockReset();
  escalateToArtisanMock.mockReset();
});

describe("sendDevisToClient — opt-out client (test requis #5)", () => {
  it("bloque l'envoi si Client.whatsappOptOut est true, sans jamais tenter d'appel Meta", async () => {
    conversationFindUniqueMock.mockResolvedValue(conversation());
    devisFindUniqueMock.mockResolvedValue(devis({ client: { name: "M. Dupont", phone: "+33612345678", whatsappOptOut: true } }));

    const outcome = await sendDevisToClient("conv_1", "user_1");

    expect(outcome).toEqual({ kind: "cannot_send", reason: "opted_out" });
    expect(claimSendAttemptMock).not.toHaveBeenCalled();
    expect(sendWhatsappDocumentMock).not.toHaveBeenCalled();
  });
});

describe("sendDevisToClient — échec définitif d'envoi -> escalade (test requis #17)", () => {
  it("escalade uniquement quand le plafond de tentatives est atteint, jamais sur un échec retryable", async () => {
    conversationFindUniqueMock.mockResolvedValue(conversation());
    devisFindUniqueMock.mockResolvedValue(devis());

    // Tentative 1/5 : échec, retryable -> pas d'escalade.
    claimSendAttemptMock.mockResolvedValue({
      outcome: "claimed",
      send: { id: "send_1", attempts: 1, devisId: "devis_1" },
    });
    sendWhatsappDocumentMock.mockRejectedValue(new Error("Meta indisponible"));

    let outcome = await sendDevisToClient("conv_1", "user_1");
    expect(outcome).toEqual({ kind: "failed" });
    expect(escalateToArtisanMock).not.toHaveBeenCalled();

    // Tentative 5/5 (plafond atteint) : échec définitif -> une escalade.
    claimSendAttemptMock.mockResolvedValue({
      outcome: "claimed",
      send: { id: "send_1", attempts: 5, devisId: "devis_1" },
    });

    outcome = await sendDevisToClient("conv_1", "user_1");
    expect(outcome).toEqual({ kind: "failed" });
    expect(escalateToArtisanMock).toHaveBeenCalledTimes(1);
    expect(escalateToArtisanMock).toHaveBeenCalledWith("user_1", "envoi_echec", "devis_1", expect.any(String));
  });

  it("un envoi déjà réussi (idempotence de lecture) ne réessaie jamais un appel Meta", async () => {
    conversationFindUniqueMock.mockResolvedValue(conversation());
    devisFindUniqueMock.mockResolvedValue(devis({ status: "envoye" }));

    const outcome = await sendDevisToClient("conv_1", "user_1");

    expect(outcome).toEqual({ kind: "already_sent", number: "D-0001", clientName: "M. Dupont" });
    expect(claimSendAttemptMock).not.toHaveBeenCalled();
    expect(sendWhatsappDocumentMock).not.toHaveBeenCalled();
  });
});
