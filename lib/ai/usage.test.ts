import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const createMock = vi.fn();
const countMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiUsageEvent: {
      create: (...args: unknown[]) => createMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}));

import {
  getMonthlyAiLimit,
  DEFAULT_MONTHLY_AI_LIMIT,
  recordAiUsage,
  getMonthlyAiUsageCount,
  isAiQuotaExceeded,
} from "@/lib/ai/usage";

beforeEach(() => {
  createMock.mockReset();
  countMock.mockReset();
  delete process.env.WHATSAPP_AI_MONTHLY_LIMIT;
});

afterEach(() => {
  delete process.env.WHATSAPP_AI_MONTHLY_LIMIT;
});

describe("getMonthlyAiLimit", () => {
  it("retombe sur la limite technique par défaut si aucune variable d'environnement n'est fournie", () => {
    expect(getMonthlyAiLimit()).toBe(DEFAULT_MONTHLY_AI_LIMIT);
  });

  it("est configurable via WHATSAPP_AI_MONTHLY_LIMIT, sans changement de code", () => {
    process.env.WHATSAPP_AI_MONTHLY_LIMIT = "50";
    expect(getMonthlyAiLimit()).toBe(50);
  });

  it("ignore une valeur invalide et retombe sur le défaut", () => {
    process.env.WHATSAPP_AI_MONTHLY_LIMIT = "not_a_number";
    expect(getMonthlyAiLimit()).toBe(DEFAULT_MONTHLY_AI_LIMIT);
    process.env.WHATSAPP_AI_MONTHLY_LIMIT = "-5";
    expect(getMonthlyAiLimit()).toBe(DEFAULT_MONTHLY_AI_LIMIT);
  });
});

describe("recordAiUsage", () => {
  // Test requis #8 : un appel réel = un événement.
  it("enregistre un seul événement par appel", async () => {
    await recordAiUsage({ userId: "user_1", kind: "extraction", success: true, inputTokens: 120, outputTokens: 40 });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      data: {
        userId: "user_1",
        kind: "extraction",
        success: true,
        inputTokens: 120,
        outputTokens: 40,
        audioSeconds: null,
      },
    });
  });

  it("ne stocke jamais de contenu (texte/transcript), uniquement des métadonnées numériques", async () => {
    await recordAiUsage({ userId: "user_1", kind: "transcription", success: true, audioSeconds: 12 });
    const payload = createMock.mock.calls[0][0].data;
    expect(Object.keys(payload).sort()).toEqual(
      ["audioSeconds", "inputTokens", "kind", "outputTokens", "success", "userId"].sort()
    );
  });
});

describe("getMonthlyAiUsageCount / isAiQuotaExceeded", () => {
  // Test requis #13 : le quota d'un artisan ne doit jamais mélanger un autre artisan.
  it("filtre strictement par userId", async () => {
    countMock.mockResolvedValue(7);
    const now = new Date("2026-09-15T10:00:00Z");
    await getMonthlyAiUsageCount("user_A", now);
    expect(countMock).toHaveBeenCalledWith({
      where: { userId: "user_A", createdAt: { gte: new Date(Date.UTC(2026, 8, 1)) } },
    });

    countMock.mockClear();
    await getMonthlyAiUsageCount("user_B", now);
    expect(countMock).toHaveBeenCalledWith({
      where: { userId: "user_B", createdAt: { gte: new Date(Date.UTC(2026, 8, 1)) } },
    });
  });

  // Test requis #11 : la limite atteinte bloque un nouvel appel.
  it("considère le quota dépassé une fois la limite atteinte (>=), pas seulement dépassée (>)", async () => {
    process.env.WHATSAPP_AI_MONTHLY_LIMIT = "10";
    countMock.mockResolvedValue(10);
    expect(await isAiQuotaExceeded("user_1")).toBe(true);

    countMock.mockResolvedValue(9);
    expect(await isAiQuotaExceeded("user_1")).toBe(false);
  });

  it("deux artisans avec des usages différents ne s'influencent jamais", async () => {
    process.env.WHATSAPP_AI_MONTHLY_LIMIT = "5";
    countMock.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === "user_over" ? 5 : 1
    );
    expect(await isAiQuotaExceeded("user_over")).toBe(true);
    expect(await isAiQuotaExceeded("user_under")).toBe(false);
  });
});
