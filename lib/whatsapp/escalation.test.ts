import { describe, it, expect, vi, beforeEach } from "vitest";

const findFirstMock = vi.fn();
const createMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      findFirst: (...args: unknown[]) => findFirstMock(...args),
      create: (...args: unknown[]) => createMock(...args),
    },
  },
}));

import { escalateToArtisan } from "@/lib/whatsapp/escalation";

beforeEach(() => {
  findFirstMock.mockReset();
  createMock.mockReset();
});

describe("escalateToArtisan (mécanisme 4, anti-spam)", () => {
  // Test requis #15 : jamais dix notifications pour le même incident.
  it("ne crée qu'une seule notification pour le même incident, malgré plusieurs appels (retries)", async () => {
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "notif_1" });

    await escalateToArtisan("user_1", "transcription_echec", "msg_1", "Un message vocal n'a pas pu être transcrit.");
    await escalateToArtisan("user_1", "transcription_echec", "msg_1", "Un message vocal n'a pas pu être transcrit.");

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("encode l'identifiant de l'INCIDENT dans le lien, jamais un id de tentative", async () => {
    findFirstMock.mockResolvedValue(null);
    await escalateToArtisan("user_1", "envoi_echec", "devis_42", "échec envoi");
    expect(findFirstMock).toHaveBeenCalledWith({
      where: { userId: "user_1", type: "whatsapp_escalade", link: "/dashboard/devis/devis_42" },
    });
  });

  it("deux incidents distincts (link différent) produisent chacun leur propre notification", async () => {
    findFirstMock.mockResolvedValue(null);
    await escalateToArtisan("user_1", "envoi_echec", "devis_1", "échec envoi devis_1");
    await escalateToArtisan("user_1", "envoi_echec", "devis_2", "échec envoi devis_2");
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
