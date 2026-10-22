import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));

import { fakePrisma } from "@/tests/support/fake-prisma";
import { nextDevisNumber, devisNumberPrefix } from "@/lib/devis/numbering";
import { createDevis } from "@/lib/devis/create-devis";

const YEAR = new Date().getFullYear();
const num = (seq: number, year = YEAR) => `DEV-${year}-${String(seq).padStart(3, "0")}`;

let userA: Record<string, unknown>;
let userB: Record<string, unknown>;
let clientA: Record<string, unknown>;

function seedDevis(userId: unknown, number: string) {
  return fakePrisma.seed("devis", { userId, clientId: clientA.id, number });
}

// nextDevisNumber exige une transaction : on reproduit l'usage réel.
const next = (userId: unknown) =>
  fakePrisma.$transaction((tx) => nextDevisNumber(tx as never, userId as string));

beforeEach(() => {
  fakePrisma.reset();
  userA = fakePrisma.seed("user", { clerkId: "clerk_A", email: "a@example.com", companyName: "A" });
  userB = fakePrisma.seed("user", { clerkId: "clerk_B", email: "b@example.com", companyName: "B" });
  clientA = fakePrisma.seed("client", { userId: userA.id, name: "Client fictif" });
});

describe("nextDevisNumber", () => {
  it("premier devis de l'année : 001", async () => {
    expect(await next(userA.id)).toBe(num(1));
    expect(devisNumberPrefix()).toBe(`DEV-${YEAR}-`);
  });

  it("[régression] après suppression d'un devis, ne rejoue jamais un numéro existant", async () => {
    seedDevis(userA.id, num(1));
    seedDevis(userA.id, num(3)); // le 002 a été supprimé
    // Ancienne règle (nombre + 1) : DEV-…-003, déjà attribué.
    expect(await next(userA.id)).toBe(num(4));
  });

  it("ignore les autres années, les autres artisans et les numéros non standard", async () => {
    seedDevis(userA.id, num(41, YEAR - 1));
    seedDevis(userA.id, `DEV-${YEAR}-BROUILLON`);
    seedDevis(userB.id, num(57));
    seedDevis(userA.id, num(2));
    expect(await next(userA.id)).toBe(num(3));
    expect(await next(userB.id)).toBe(num(58));
  });

  it("dépasse 999 sans tronquer", async () => {
    seedDevis(userA.id, num(999));
    expect(await next(userA.id)).toBe(`DEV-${YEAR}-1000`);
  });

  it("prend un verrou par artisan, à l'intérieur de la transaction", async () => {
    await next(userA.id);
    await next(userB.id);
    expect(fakePrisma.advisoryLocks).toEqual([
      { key: `gestly:devis-number:${userA.id}`, inTransaction: true },
      { key: `gestly:devis-number:${userB.id}`, inTransaction: true },
    ]);
  });
});

describe("createDevis — chemin web (sans transaction fournie)", () => {
  const input = () => ({
    userId: userA.id as string,
    clientId: clientA.id as string,
    lines: [{ description: "Prestation fictive", quantity: 2, unitPriceHT: 50, tvaRate: 20 }],
  });

  it("ouvre sa propre transaction et numérote sous verrou", async () => {
    const devis = await createDevis(input());
    expect(devis.number).toBe(num(1));
    expect(fakePrisma.advisoryLocks).toEqual([{ key: `gestly:devis-number:${userA.id}`, inTransaction: true }]);
    expect(devis).toMatchObject({ totalHT: 100, totalTVA: 20, totalTTC: 120 });
  });

  it("[régression] créations successives après suppression : numéros toujours uniques", async () => {
    const first = await createDevis(input());
    const second = await createDevis(input());
    fakePrisma.store.devis = fakePrisma.store.devis.filter((d) => d.id !== first.id);
    const third = await createDevis(input());
    const numbers = fakePrisma.rows("devis").map((d) => d.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect([second.number, third.number]).toEqual([num(2), num(3)]);
  });

  it("en cas d'erreur, rien n'est créé (transaction annulée)", async () => {
    fakePrisma.failNext("devis.create", new Error("panne base"));
    await expect(createDevis(input())).rejects.toThrow("panne base");
    expect(fakePrisma.rows("devis")).toHaveLength(0);
  });
});
