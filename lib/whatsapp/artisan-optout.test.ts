import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const updateManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappConversation: {
      update: (...args: unknown[]) => updateMock(...args),
      updateMany: (...args: unknown[]) => updateManyMock(...args),
    },
  },
}));

import {
  isStopCommand,
  isStartCommand,
  disableArtisanBot,
  enableArtisanBot,
  enableArtisanBotForUser,
} from "@/lib/whatsapp/artisan-optout";

beforeEach(() => {
  updateMock.mockReset();
  updateManyMock.mockReset();
});

describe("isStopCommand", () => {
  it("reconnaît le mot-clé isolé, insensible à la casse et aux espaces", () => {
    expect(isStopCommand("STOP")).toBe(true);
    expect(isStopCommand("stop")).toBe(true);
    expect(isStopCommand("  Stop  ")).toBe(true);
    expect(isStopCommand("Stop.")).toBe(true);
    expect(isStopCommand("stop!")).toBe(true);
  });

  // Test requis #4 : "stop" au milieu d'une phrase n'est jamais un opt-out.
  it("ignore 'stop' au milieu d'une phrase métier normale", () => {
    expect(isStopCommand("il faut stopper le chantier")).toBe(false);
    expect(isStopCommand("stop tout de suite")).toBe(false);
    expect(isStopCommand("peux-tu stop le devis en cours")).toBe(false);
    expect(isStopCommand("")).toBe(false);
  });
});

describe("isStartCommand", () => {
  it("reconnaît le mot-clé isolé", () => {
    expect(isStartCommand("START")).toBe(true);
    expect(isStartCommand("start")).toBe(true);
    expect(isStartCommand(" Start ! ")).toBe(true);
  });

  it("ignore 'start' au milieu d'une phrase", () => {
    expect(isStartCommand("on peut start le chantier lundi")).toBe(false);
  });
});

describe("disableArtisanBot / enableArtisanBot", () => {
  it("désactive la conversation ciblée", async () => {
    await disableArtisanBot("conv_1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { optedOut: true },
    });
  });

  it("réactive la conversation ciblée", async () => {
    await enableArtisanBot("conv_1");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: "conv_1" },
      data: { optedOut: false },
    });
  });

  it("réactive toutes les conversations opted-out d'un utilisateur (affordance paramètres)", async () => {
    updateManyMock.mockResolvedValue({ count: 2 });
    const count = await enableArtisanBotForUser("user_1");
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { userId: "user_1", optedOut: true },
      data: { optedOut: false },
    });
    expect(count).toBe(2);
  });
});
