import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// Fake table en mémoire qui reproduit fidèlement une VRAIE contrainte
// d'unicité Postgres sur (userId, dedupeKey) — permet de tester une
// véritable course concurrente (Promise.all) plutôt que de supposer que
// l'atomicité fonctionne.
const rows: Array<{ userId: string; dedupeKey: string | null }> = [];

function uniqueViolation() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notification: {
      create: async ({ data }: { data: { userId: string; dedupeKey?: string | null } }) => {
        const dedupeKey = data.dedupeKey ?? null;
        if (dedupeKey !== null && rows.some((r) => r.userId === data.userId && r.dedupeKey === dedupeKey)) {
          throw uniqueViolation();
        }
        rows.push({ userId: data.userId, dedupeKey });
        return data;
      },
    },
  },
}));

import { createNotificationOnce, createNotification } from "@/lib/notifications";

beforeEach(() => {
  rows.length = 0;
});

describe("createNotificationOnce — unicité en concurrence garantie par la DB", () => {
  it("un seul appel passe, le second (même incident) est silencieusement ignoré", async () => {
    await createNotificationOnce("user_1", "whatsapp_escalade", "premier essai", "/dashboard/devis/devis_1");
    await createNotificationOnce("user_1", "whatsapp_escalade", "second essai (retry)", "/dashboard/devis/devis_1");

    expect(rows).toHaveLength(1);
  });

  // Le test qui compte vraiment : une VRAIE course (Promise.all), pas deux
  // appels séquentiels — c'est exactement le scénario que findFirst+create
  // (l'ancienne implémentation) ne pouvait pas garantir.
  it("sous course concurrente réelle (Promise.all), une seule notification est créée pour le même incident", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        createNotificationOnce("user_1", "whatsapp_escalade", "tentative concurrente", "/dashboard/devis/devis_1")
      )
    );

    expect(rows).toHaveLength(1);
  });

  it("deux incidents distincts (link différent) produisent chacun leur notification, même en concurrence", async () => {
    await Promise.all([
      createNotificationOnce("user_1", "whatsapp_escalade", "incident A", "/dashboard/devis/devis_A"),
      createNotificationOnce("user_1", "whatsapp_escalade", "incident B", "/dashboard/devis/devis_B"),
    ]);

    expect(rows).toHaveLength(2);
  });

  it("ne concerne jamais createNotification (relances) : dedupeKey reste null, jamais bloqué par l'index", async () => {
    // Même (userId, type, link) répété plusieurs fois, comme le fait
    // légitimement lib/relances/engine.ts à chaque niveau de relance.
    await createNotification("user_1", "relance_envoyee", "Relance niveau 1", "/dashboard/factures/f1");
    await createNotification("user_1", "relance_envoyee", "Relance niveau 2", "/dashboard/factures/f1");
    await createNotification("user_1", "relance_envoyee", "Relance niveau 3", "/dashboard/factures/f1");

    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.dedupeKey === null)).toBe(true);
  });
});
