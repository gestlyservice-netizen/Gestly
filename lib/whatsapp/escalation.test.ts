import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Fake table reproduisant la vraie contrainte unique partielle (userId,
// dedupeKey) posée en base par lib/notifications.ts (étape 8bis) — cohérent
// avec lib/notifications.test.ts, qui teste ce mécanisme en détail.
const rows: Array<{ userId: string; dedupeKey: string | null }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: async ({ data }: { data: { userId: string; dedupeKey?: string | null } }) => {
        const dedupeKey = data.dedupeKey ?? null;
        if (dedupeKey !== null && rows.some((r) => r.userId === data.userId && r.dedupeKey === dedupeKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        rows.push({ userId: data.userId, dedupeKey });
        return data;
      },
    },
  },
}));

import { escalateToArtisan } from "@/lib/whatsapp/escalation";

beforeEach(() => {
  rows.length = 0;
});

describe("escalateToArtisan (mécanisme 4, anti-spam)", () => {
  // Test requis #15 : jamais dix notifications pour le même incident.
  it("ne crée qu'une seule notification pour le même incident, malgré plusieurs appels (retries)", async () => {
    await escalateToArtisan("user_1", "transcription_echec", "msg_1", "Un message vocal n'a pas pu être transcrit.");
    await escalateToArtisan("user_1", "transcription_echec", "msg_1", "Un message vocal n'a pas pu être transcrit.");

    expect(rows).toHaveLength(1);
  });

  it("encode l'identifiant de l'INCIDENT dans le lien, jamais un id de tentative", async () => {
    await escalateToArtisan("user_1", "envoi_echec", "devis_42", "échec envoi");
    expect(rows[0].dedupeKey).toBe("whatsapp_escalade:/dashboard/devis/devis_42");
  });

  it("deux incidents distincts (link différent) produisent chacun leur propre notification", async () => {
    await escalateToArtisan("user_1", "envoi_echec", "devis_1", "échec envoi devis_1");
    await escalateToArtisan("user_1", "envoi_echec", "devis_2", "échec envoi devis_2");
    expect(rows).toHaveLength(2);
  });
});
