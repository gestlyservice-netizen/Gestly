import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", async () => ({ prisma: (await import("@/tests/support/fake-prisma")).fakePrisma }));

import { fakePrisma } from "@/tests/support/fake-prisma";
import {
  allocateDocumentNumber,
  applyRequestedNext,
  NextNumberError,
  readSeriesState,
  resolveSeries,
  sequenceInSeries,
  formatDocumentNumber,
  type DocumentKind,
  type NumberingSettings,
} from "@/lib/numbering/document-number";
import { createDevis } from "@/lib/devis/create-devis";

const YEAR = new Date().getFullYear();
const legacy = (kind: "DEV" | "FAC" | "AV", seq: number, year = YEAR) => `${kind}-${year}-${String(seq).padStart(3, "0")}`;

let userA: Record<string, unknown>;
let userB: Record<string, unknown>;
let clientA: Record<string, unknown>;

const settingsDefaults: NumberingSettings = { prefixeDevis: "DEV-", prefixeFacture: "FAC-", prochainNumeroDevis: 1, prochainNumeroFacture: 1 };
const allocate = (kind: DocumentKind, userId: unknown) =>
  fakePrisma.$transaction((tx) => allocateDocumentNumber(tx as never, kind, userId as string));
const model = (kind: DocumentKind) => kind;
function seedDoc(kind: DocumentKind, userId: unknown, number: string) {
  const base = { userId, clientId: clientA.id, number, totalHT: 100, totalTVA: 20, totalTTC: 120 };
  return fakePrisma.seed(model(kind), kind === "avoir" ? { ...base, factureId: "facture_x", reason: "test" } : base);
}
const settingsOf = (userId: unknown) => fakePrisma.rows("settings").find((s) => s.userId === userId)!;

beforeEach(() => {
  fakePrisma.reset();
  userA = fakePrisma.seed("user", { clerkId: "clerk_A", email: "a@example.com", companyName: "A" });
  userB = fakePrisma.seed("user", { clerkId: "clerk_B", email: "b@example.com", companyName: "B" });
  clientA = fakePrisma.seed("client", { userId: userA.id, name: "Client fictif" });
});

describe("resolveSeries — signification des paramètres", () => {
  it("sans paramètres ou avec les préfixes par défaut : série annuelle historique, « Prochain n° » ignoré", () => {
    expect(resolveSeries("devis", null)).toEqual({ prefix: `DEV-${YEAR}-`, custom: false, floor: 1 });
    expect(resolveSeries("facture", { ...settingsDefaults, prochainNumeroFacture: 500 })).toEqual({ prefix: `FAC-${YEAR}-`, custom: false, floor: 1 });
  });

  it("préfixe personnalisé : utilisé tel quel, « Prochain n° » comme numéro de départ", () => {
    expect(resolveSeries("devis", { ...settingsDefaults, prefixeDevis: "D2026-", prochainNumeroDevis: 40 })).toEqual({ prefix: "D2026-", custom: true, floor: 40 });
    expect(resolveSeries("facture", { ...settingsDefaults, prefixeFacture: " FA/ " })).toEqual({ prefix: "FA/", custom: true, floor: 1 });
  });

  it("avoirs : toujours la série annuelle AV- (aucun paramètre dédié)", () => {
    expect(resolveSeries("avoir", { ...settingsDefaults, prefixeFacture: "X-" })).toEqual({ prefix: `AV-${YEAR}-`, custom: false, floor: 1 });
  });

  it("changement d'année : nouvelle série historique, remise à 001", () => {
    expect(resolveSeries("facture", null, new Date("2027-01-02T08:00:00")).prefix).toBe("FAC-2027-");
  });

  it("valeurs aberrantes de « Prochain n° » ramenées à 1", () => {
    expect(resolveSeries("devis", { ...settingsDefaults, prefixeDevis: "D-", prochainNumeroDevis: 0 }).floor).toBe(1);
    expect(resolveSeries("devis", { ...settingsDefaults, prefixeDevis: "D-", prochainNumeroDevis: 2.5 }).floor).toBe(1);
  });
});

describe("sequenceInSeries / formatDocumentNumber", () => {
  it("ne compte que les numéros de la série, à suffixe purement numérique", () => {
    expect(sequenceInSeries("DEV-2026-007", "DEV-2026-")).toBe(7);
    expect(sequenceInSeries("DEV-2026-007", "DEV")).toBeNull(); // suffixe "-2026-007"
    expect(sequenceInSeries("DEV-2026-BROUILLON", "DEV-2026-")).toBeNull();
    expect(sequenceInSeries("FAC-2026-001", "DEV-2026-")).toBeNull();
  });

  it("3 chiffres minimum, sans troncature", () => {
    expect(formatDocumentNumber("F-", 7)).toBe("F-007");
    expect(formatDocumentNumber("F-", 1234)).toBe("F-1234");
  });
});

describe("allocateDocumentNumber — séries historiques", () => {
  it.each(["devis", "facture", "avoir"] as const)("%s : 001 puis plus grand numéro + 1, verrou dédié par type", async (kind) => {
    const code = kind === "devis" ? "DEV" : kind === "facture" ? "FAC" : "AV";
    expect((await allocate(kind, userA.id)).number).toBe(legacy(code, 1));
    seedDoc(kind, userA.id, legacy(code, 1));
    seedDoc(kind, userA.id, legacy(code, 4)); // trou (2, 3 supprimés ou jamais créés)
    expect((await allocate(kind, userA.id)).number).toBe(legacy(code, 5));
    expect(fakePrisma.advisoryLocks.every((l) => l.inTransaction && l.key === `gestly:${kind}-number:${userA.id}`)).toBe(true);
  });

  it("les numéros des années précédentes et des autres artisans sont ignorés", async () => {
    seedDoc("facture", userA.id, legacy("FAC", 88, YEAR - 1));
    seedDoc("facture", userB.id, legacy("FAC", 12));
    expect((await allocate("facture", userA.id)).number).toBe(legacy("FAC", 1));
    expect((await allocate("facture", userB.id)).number).toBe(legacy("FAC", 13));
  });

  it("aucun paramètre n'est créé ni modifié en série historique", async () => {
    await allocate("devis", userA.id);
    expect(fakePrisma.rows("settings")).toHaveLength(0);
  });
});

describe("allocateDocumentNumber — préfixes personnalisés et « Prochain n° »", () => {
  beforeEach(() => {
    fakePrisma.seed("settings", { userId: userA.id, prefixeFacture: "F2026-", prochainNumeroFacture: 152, prefixeDevis: "D-" });
  });

  it("démarre au « Prochain n° » puis le fait avancer (paramètre toujours exact)", async () => {
    expect((await allocate("facture", userA.id)).number).toBe("F2026-152");
    expect(settingsOf(userA.id).prochainNumeroFacture).toBe(153);
    expect((await allocate("facture", userA.id)).number).toBe("F2026-153");
    expect(settingsOf(userA.id).prochainNumeroFacture).toBe(154);
  });

  it("[suppression] le dernier document supprimé ne libère jamais son numéro", async () => {
    const first = await allocate("facture", userA.id);
    // Le document F2026-152 n'existe plus (ou n'a jamais été conservé) :
    expect(fakePrisma.rows("facture")).toHaveLength(0);
    expect(first.number).toBe("F2026-152");
    expect((await allocate("facture", userA.id)).number).toBe("F2026-153");
  });

  it("« Prochain n° » inférieur à l'existant : ignoré, jamais de réutilisation", async () => {
    seedDoc("facture", userA.id, "F2026-300");
    expect((await allocate("facture", userA.id)).number).toBe("F2026-301");
    expect(settingsOf(userA.id).prochainNumeroFacture).toBe(302);
  });

  it("devis et factures ont des compteurs indépendants ; les paramètres d'un artisan ne s'appliquent pas à un autre", async () => {
    expect((await allocate("devis", userA.id)).number).toBe("D-001");
    expect(settingsOf(userA.id)).toMatchObject({ prochainNumeroDevis: 2, prochainNumeroFacture: 152 });
    expect((await allocate("facture", userB.id)).number).toBe(legacy("FAC", 1));
  });

  it("préfixe remis à la valeur par défaut : retour à la série historique annuelle", async () => {
    fakePrisma.store.settings[0].prefixeFacture = "FAC-";
    expect((await allocate("facture", userA.id)).number).toBe(legacy("FAC", 1));
  });
});

describe("créations simultanées", () => {
  const createMany = (n: number) =>
    Promise.all(
      Array.from({ length: n }, () =>
        createDevis({ userId: userA.id as string, clientId: clientA.id as string, lines: [{ description: "x", quantity: 1, unitPriceHT: 10, tvaRate: 20 }] })
      )
    );

  it("10 devis créés en parallèle : 10 numéros uniques et consécutifs, dates dans l'ordre des numéros", async () => {
    const created = await createMany(10);
    const numbers = created.map((d) => d.number).sort();
    expect(numbers).toEqual(Array.from({ length: 10 }, (_, i) => legacy("DEV", i + 1)));

    // Chronologie : la date d'émission ne décroît jamais quand le numéro
    // augmente (deux émissions sérialisées dans la même milliseconde
    // peuvent partager la même date).
    const byNumber = [...fakePrisma.rows("devis")].sort((a, b) => String(a.number).localeCompare(String(b.number)));
    for (let i = 1; i < byNumber.length; i++) {
      expect((byNumber[i].createdAt as Date).getTime()).toBeGreaterThanOrEqual((byNumber[i - 1].createdAt as Date).getTime());
    }
  });

  it("contrôle : SANS verrou, les mêmes créations parallèles produisent des doublons", async () => {
    fakePrisma.locksDisabled = true;
    const created = await createMany(10);
    expect(new Set(created.map((d) => d.number)).size).toBeLessThan(10);
  });

  it("préfixe personnalisé en parallèle : « Prochain n° » avancé exactement de 5", async () => {
    fakePrisma.seed("settings", { userId: userA.id, prefixeDevis: "Q-", prochainNumeroDevis: 20 });
    const created = await createMany(5);
    expect(created.map((d) => d.number).sort()).toEqual(["Q-020", "Q-021", "Q-022", "Q-023", "Q-024"]);
    expect(settingsOf(userA.id).prochainNumeroDevis).toBe(25);
  });
});

describe("erreurs et reprises de transaction", () => {
  it("échec après attribution : rien n'est créé, le compteur n'avance pas, la reprise réutilise le numéro non émis", async () => {
    fakePrisma.seed("settings", { userId: userA.id, prefixeDevis: "R-", prochainNumeroDevis: 7 });
    fakePrisma.failNext("devis.create", new Error("panne base"));
    const input = { userId: userA.id as string, clientId: clientA.id as string, lines: [{ description: "x", quantity: 1, unitPriceHT: 1, tvaRate: 20 }] };

    await expect(createDevis(input)).rejects.toThrow("panne base");
    expect(fakePrisma.rows("devis")).toHaveLength(0);
    expect(settingsOf(userA.id).prochainNumeroDevis).toBe(7);

    expect((await createDevis(input)).number).toBe("R-007");
  });

  it("le verrou est libéré même en cas d'échec : la création suivante n'est pas bloquée", async () => {
    fakePrisma.failNext("devis.create", new Error("panne base"));
    const input = { userId: userA.id as string, clientId: clientA.id as string, lines: [{ description: "x", quantity: 1, unitPriceHT: 1, tvaRate: 20 }] };
    await expect(createDevis(input)).rejects.toThrow();
    await expect(createDevis(input)).resolves.toMatchObject({ number: legacy("DEV", 1) });
  });
});

// ── Décisions métier D1 à D4 (validées le 2026-10-22) ─────────────────────

const atYear = (year: number) => new Date(`${year}-06-15T10:00:00`);
const allocateAt = (kind: DocumentKind, userId: unknown, now: Date) =>
  fakePrisma.$transaction((tx) => allocateDocumentNumber(tx as never, kind, userId as string, now));
const requestNext = (kind: "devis" | "facture", userId: unknown, settings: NumberingSettings, value: number, now?: Date) =>
  fakePrisma.$transaction((tx) => applyRequestedNext(tx as never, kind, userId as string, settings, value, now));
const nextOf = (kind: DocumentKind, userId: unknown, settings: NumberingSettings | null, now?: Date) =>
  fakePrisma.$transaction(async (tx) => (await readSeriesState(tx as never, kind, userId as string, settings, now)).next);

describe("D4 — un numéro attribué n'est jamais réattribué (compteurs)", () => {
  it("[régression] série annuelle : le dernier devis brouillon supprimé ne libère pas son numéro", async () => {
    const first = await allocate("devis", userA.id);
    expect(first.number).toBe(legacy("DEV", 1));
    // Aucun devis n'a été conservé (brouillon supprimé) : avant les
    // compteurs, le numéro 001 était réattribué.
    expect(fakePrisma.rows("devis")).toHaveLength(0);
    expect((await allocate("devis", userA.id)).number).toBe(legacy("DEV", 2));
  });

  it("compteurs distincts par artisan, par type et par série", async () => {
    await allocate("devis", userA.id);
    await allocate("facture", userA.id);
    await allocate("avoir", userA.id);
    await allocate("devis", userB.id);
    const keys = fakePrisma.rows("documentNumberCounter").map((c) => `${c.userId === userA.id ? "A" : "B"}:${c.kind}:${c.series}:${c.nextValue}`).sort();
    expect(keys).toEqual([`A:avoir:AV-${YEAR}-:2`, `A:devis:DEV-${YEAR}-:2`, `A:facture:FAC-${YEAR}-:2`, `B:devis:DEV-${YEAR}-:2`]);
  });
});

describe("D1 — série annuelle par défaut et « Prochain n° » cohérent", () => {
  it("remise à 001 chaque année, indépendamment du compteur de l'année précédente", async () => {
    for (let i = 0; i < 3; i++) await allocateAt("facture", userA.id, atYear(2026));
    expect((await allocateAt("facture", userA.id, atYear(2027))).number).toBe("FAC-2027-001");
    expect((await allocateAt("facture", userA.id, atYear(2026))).number).toBe("FAC-2026-004");
  });

  it("« Prochain n° » affiché = numéro réellement attribué (existant, compteur, année)", async () => {
    seedDoc("devis", userA.id, legacy("DEV", 7));
    expect(await nextOf("devis", userA.id, settingsDefaults)).toBe(8);
    expect(await nextOf("devis", userA.id, settingsDefaults, atYear(YEAR + 1))).toBe(1);
  });

  it("choisir un numéro de départ supérieur : appliqué à la série de l'année en cours uniquement", async () => {
    await requestNext("facture", userA.id, settingsDefaults, 150, atYear(2026));
    expect((await allocateAt("facture", userA.id, atYear(2026))).number).toBe("FAC-2026-150");
    expect((await allocateAt("facture", userA.id, atYear(2027))).number).toBe("FAC-2027-001");
  });

  it("valeur inférieure au prochain numéro réel : refus explicite, rien n'est modifié", async () => {
    seedDoc("facture", userA.id, legacy("FAC", 12));
    const err = await requestNext("facture", userA.id, settingsDefaults, 5).catch((e) => e);
    expect(err).toBeInstanceOf(NextNumberError);
    expect(err.message).toMatch(/ne peut pas être inférieur à 13/);
    expect(fakePrisma.rows("documentNumberCounter")).toHaveLength(0);
  });

  it("valeur égale au prochain numéro réel (enregistrement des Paramètres sans changement) : acceptée sans effet", async () => {
    seedDoc("facture", userA.id, legacy("FAC", 12));
    await expect(requestNext("facture", userA.id, settingsDefaults, 13)).resolves.toBeUndefined();
    expect(fakePrisma.rows("documentNumberCounter")).toHaveLength(0);
  });

  it("valeur non entière ou nulle : refus explicite", async () => {
    await expect(requestNext("devis", userA.id, settingsDefaults, 0)).rejects.toBeInstanceOf(NextNumberError);
    await expect(requestNext("devis", userA.id, settingsDefaults, 2.5)).rejects.toBeInstanceOf(NextNumberError);
  });
});

describe("D2 — préfixe personnalisé : série continue", () => {
  it("aucune remise à zéro au changement d'année", async () => {
    const custom = { ...settingsDefaults, prefixeFacture: "F-" };
    fakePrisma.seed("settings", { userId: userA.id, ...custom });
    expect((await allocateAt("facture", userA.id, atYear(2026))).number).toBe("F-001");
    expect((await allocateAt("facture", userA.id, atYear(2027))).number).toBe("F-002");
  });

  it("le compteur de la série personnalisée prévaut ; « Prochain n° » plus élevé appliqué", async () => {
    const custom = { ...settingsDefaults, prefixeDevis: "D-", prochainNumeroDevis: 1 };
    fakePrisma.seed("settings", { userId: userA.id, ...custom });
    await allocate("devis", userA.id); // D-001
    await requestNext("devis", userA.id, custom, 40);
    expect((await allocate("devis", userA.id)).number).toBe("D-040");
  });
});

describe("D3 — avoirs : série annuelle indépendante", () => {
  it("indépendante des factures, remise à 001 chaque année", async () => {
    for (let i = 0; i < 4; i++) await allocateAt("facture", userA.id, atYear(2026));
    expect((await allocateAt("avoir", userA.id, atYear(2026))).number).toBe("AV-2026-001");
    expect((await allocateAt("avoir", userA.id, atYear(2027))).number).toBe("AV-2027-001");
  });
});

describe("avant la migration des compteurs (table absente)", () => {
  beforeEach(() => {
    fakePrisma.countersTableExists = false;
  });

  it("la numérotation fonctionne sans jamais accéder à la table absente", async () => {
    seedDoc("devis", userA.id, legacy("DEV", 2));
    expect((await allocate("devis", userA.id)).number).toBe(legacy("DEV", 3));
    expect(fakePrisma.calls.some((c) => c.op.startsWith("documentNumberCounter."))).toBe(false);
  });

  it("« Prochain n° » différent en série annuelle : refus explicite (jamais ignoré)", async () => {
    const err = await requestNext("devis", userA.id, settingsDefaults, 50).catch((e) => e);
    expect(err).toBeInstanceOf(NextNumberError);
    expect(err.message).toMatch(/disponible après la mise à jour de la base/);
  });

  it("préfixe personnalisé : « Prochain n° » accepté (porté par les Paramètres)", async () => {
    await expect(requestNext("facture", userA.id, { ...settingsDefaults, prefixeFacture: "F-" }, 30)).resolves.toBeUndefined();
  });

  it("limite connue, levée par la migration : le dernier brouillon supprimé libère son numéro en série annuelle", async () => {
    await allocate("devis", userA.id);
    expect((await allocate("devis", userA.id)).number).toBe(legacy("DEV", 1));
  });
});
