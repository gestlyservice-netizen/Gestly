import { describe, it, expect, vi, beforeEach } from "vitest";

// Fake Prisma en mémoire pour WhatsappMessage, suffisant pour reproduire
// fidèlement la sémantique des requêtes atomiques utilisées par
// extraction-checkpoint.ts (updateMany conditionné, comme le ferait
// réellement Postgres) — plus robuste qu'un enchaînement de mockResolvedValue
// pour tester une vraie situation de concurrence (test #5).
interface FakeMessageRow {
  id: string;
  extractionStatus: string | null;
  extractionResult: unknown;
  extractionModel: string | null;
  updatedAt: Date;
}

function makeFakeWhatsappMessageTable() {
  const rows = new Map<string, FakeMessageRow>();

  function seed(id: string, overrides: Partial<FakeMessageRow> = {}) {
    rows.set(id, {
      id,
      extractionStatus: null,
      extractionResult: null,
      extractionModel: null,
      updatedAt: new Date(),
      ...overrides,
    });
  }

  async function findUniqueOrThrow({ where: { id } }: { where: { id: string } }) {
    const row = rows.get(id);
    if (!row) throw new Error(`row ${id} not found`);
    return { ...row };
  }

  // Reproduit le WHERE utilisé par le claim atomique : id + (extractionStatus
  // null OU "processing" mais périmé). Ne matche/écrit rien sinon — exactement
  // le comportement Postgres exploité par le code réel.
  async function updateMany({
    where,
    data,
  }: {
    where: { id: string; OR?: Array<Record<string, unknown>>; extractionStatus?: string };
    data: Partial<FakeMessageRow>;
  }) {
    const row = rows.get(where.id);
    if (!row) return { count: 0 };

    let matches: boolean;
    if (where.OR) {
      matches = where.OR.some((cond) => {
        if (cond.extractionStatus === null) return row.extractionStatus === null;
        if (cond.extractionStatus === "processing") {
          const staleBefore = (cond.updatedAt as { lt: Date }).lt;
          return row.extractionStatus === "processing" && row.updatedAt < staleBefore;
        }
        return false;
      });
    } else {
      matches = row.extractionStatus === where.extractionStatus;
    }

    if (!matches) return { count: 0 };

    Object.assign(row, data, { updatedAt: new Date() });
    return { count: 1 };
  }

  async function update({ where: { id }, data }: { where: { id: string }; data: Partial<FakeMessageRow> }) {
    const row = rows.get(id);
    if (!row) throw new Error(`row ${id} not found`);
    Object.assign(row, data, { updatedAt: new Date() });
    return { ...row };
  }

  return { rows, seed, findUniqueOrThrow, updateMany, update };
}

const fakeTable = makeFakeWhatsappMessageTable();
const extractDevisInfoMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    whatsappMessage: {
      findUniqueOrThrow: (...args: Parameters<typeof fakeTable.findUniqueOrThrow>) => fakeTable.findUniqueOrThrow(...args),
      updateMany: (...args: Parameters<typeof fakeTable.updateMany>) => fakeTable.updateMany(...args),
      update: (...args: Parameters<typeof fakeTable.update>) => fakeTable.update(...args),
    },
  },
}));

vi.mock("@/lib/whatsapp/extraction", () => ({
  extractDevisInfo: (...args: unknown[]) => extractDevisInfoMock(...args),
}));

vi.mock("@/lib/ai/config", () => ({
  getWhatsappExtractionModel: () => "openai/gpt-4o-mini",
  DEFAULT_TVA_RATE: 20,
  describeModel: (model: unknown) => (typeof model === "string" ? model : "openai/gpt-4o-mini"),
}));

import { resolveExtractionResult } from "@/lib/whatsapp/extraction-checkpoint";
import { emptyPendingDevis, mergePendingDevis, type RawExtraction } from "@/lib/whatsapp/pending-devis";
import { DEFAULT_TVA_RATE } from "@/lib/ai/config";

function extractionInput(overrides: Partial<Parameters<typeof resolveExtractionResult>[1]> = {}) {
  return {
    userId: "user_1",
    message: "Devis pour M. Dupont, peinture, 500€",
    recentHistory: [],
    currentPendingDevis: emptyPendingDevis(),
    ...overrides,
  };
}

function rawResult(objet: string): RawExtraction {
  return {
    intent: "devis",
    reponseConfirmation: null,
    client: { nom: "M. Dupont", telephone: null, email: null, adresse: null },
    objet,
    descriptionTravaux: null,
    lignes: [],
    montantMentionne: null,
    notes: null,
    plusieursDevisDetectes: false,
    ambiguites: [],
  };
}

beforeEach(() => {
  fakeTable.rows.clear();
  extractDevisInfoMock.mockReset();
});

describe("resolveExtractionResult — idempotence de l'extraction IA (étape 8bis)", () => {
  // Test requis #1
  it("premier traitement : un appel modèle, résultat checkpointé", async () => {
    fakeTable.seed("msg_1");
    extractDevisInfoMock.mockResolvedValue(rawResult("Peinture salon"));

    const result = await resolveExtractionResult("msg_1", extractionInput(), {});

    expect(result.objet).toBe("Peinture salon");
    expect(extractDevisInfoMock).toHaveBeenCalledTimes(1);
    const row = fakeTable.rows.get("msg_1")!;
    expect(row.extractionStatus).toBe("done");
    expect(row.extractionResult).toEqual(rawResult("Peinture salon"));
    expect(row.extractionModel).toBe("openai/gpt-4o-mini");
  });

  // Test requis #2 et #4 : retry après extraction réussie -> checkpoint réutilisé.
  it("retry après extraction déjà réussie : zéro nouvel appel modèle, checkpoint réutilisé", async () => {
    fakeTable.seed("msg_1");
    extractDevisInfoMock.mockResolvedValue(rawResult("Peinture salon"));

    const first = await resolveExtractionResult("msg_1", extractionInput(), {});
    // Simule un retry de job : la panne est ARRIVÉE APRÈS l'extraction
    // (ex. l'envoi de la réponse a échoué) — on rappelle resolveExtractionResult
    // pour le même messageId, comme le ferait processWhatsappJob relancé.
    const second = await resolveExtractionResult("msg_1", extractionInput(), {});

    expect(extractDevisInfoMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  // Test requis #3 : retry après échec AVANT obtention d'une extraction -> nouvel appel autorisé.
  it("retry après échec du modèle lui-même : nouvel appel autorisé", async () => {
    fakeTable.seed("msg_1");
    extractDevisInfoMock.mockRejectedValueOnce(new Error("panne fournisseur"));

    await expect(resolveExtractionResult("msg_1", extractionInput(), {})).rejects.toThrow("panne fournisseur");

    const rowAfterFailure = fakeTable.rows.get("msg_1")!;
    expect(rowAfterFailure.extractionStatus).toBeNull(); // jamais un état mort

    extractDevisInfoMock.mockResolvedValueOnce(rawResult("Plomberie"));
    const result = await resolveExtractionResult("msg_1", extractionInput(), {});

    expect(result.objet).toBe("Plomberie");
    expect(extractDevisInfoMock).toHaveBeenCalledTimes(2);
  });

  // Test requis #5 : deux workers concurrents -> au maximum un appel logique exploitable.
  it("deux workers concurrents sur le même message : un seul appel modèle, le second abandonne", async () => {
    fakeTable.seed("msg_1");
    extractDevisInfoMock.mockResolvedValue(rawResult("Peinture salon"));

    // Le premier worker réclame le message (processing) mais n'a pas encore
    // fini son appel modèle quand le second tente de réclamer à son tour.
    const claim = await fakeTable.updateMany({
      where: { id: "msg_1", OR: [{ extractionStatus: null }] },
      data: { extractionStatus: "processing" },
    });
    expect(claim.count).toBe(1);

    // Le second worker (résolution complète, pas seulement le claim) doit
    // échouer sans jamais appeler le modèle.
    await expect(resolveExtractionResult("msg_1", extractionInput(), {})).rejects.toThrow(/concurrence/);
    expect(extractDevisInfoMock).not.toHaveBeenCalled();
  });

  // Test requis #6 : nouveau message -> nouvelle extraction normale.
  it("un nouveau message (nouvel id) déclenche toujours sa propre extraction", async () => {
    fakeTable.seed("msg_A");
    fakeTable.seed("msg_B");
    extractDevisInfoMock
      .mockResolvedValueOnce(rawResult("Peinture salon"))
      .mockResolvedValueOnce(rawResult("Plomberie cuisine"));

    const resultA = await resolveExtractionResult("msg_A", extractionInput({ message: "message A" }), {});
    const resultB = await resolveExtractionResult("msg_B", extractionInput({ message: "message B" }), {});

    expect(extractDevisInfoMock).toHaveBeenCalledTimes(2);
    expect(resultA.objet).toBe("Peinture salon");
    expect(resultB.objet).toBe("Plomberie cuisine");
  });

  // Test requis #7 : les corrections multi-tours continuent à fonctionner —
  // chaque message garde son propre résultat en cache (jamais mélangé), et
  // la fusion normale (mergePendingDevis, inchangée) continue de s'appuyer
  // dessus message après message.
  it("multi-tours : deux messages distincts produisent deux extractions indépendantes qui se cumulent normalement", async () => {
    fakeTable.seed("msg_A");
    fakeTable.seed("msg_B");
    const rawA: RawExtraction = {
      ...rawResult("Peinture salon"),
      lignes: [{ ligneCibleIndex: null, description: "Peinture", quantite: null, unite: null, prixUnitaire: 500, montant: null, tva: null }],
    };
    const rawB: RawExtraction = {
      ...rawResult("Peinture salon"),
      objet: null, // message B ne répète pas l'objet, seulement une correction
      lignes: [{ ligneCibleIndex: 0, description: "Peinture", quantite: 2, unite: "m²", prixUnitaire: null, montant: null, tva: null }],
    };
    extractDevisInfoMock.mockResolvedValueOnce(rawA).mockResolvedValueOnce(rawB);

    const resultA = await resolveExtractionResult("msg_A", extractionInput({ message: "peinture salon 500€" }), {});
    let draft = mergePendingDevis(emptyPendingDevis(), resultA, DEFAULT_TVA_RATE);
    expect(draft.objet.value).toBe("Peinture salon");
    expect(draft.lignes[0].prixUnitaire.value).toBe(500);

    const resultB = await resolveExtractionResult("msg_B", extractionInput({ message: "en fait 2m²", currentPendingDevis: draft }), {});
    draft = mergePendingDevis(draft, resultB, DEFAULT_TVA_RATE);

    // La correction s'applique (quantité renseignée) sans jamais perdre les
    // informations déjà connues du message précédent (objet, prix).
    expect(draft.objet.value).toBe("Peinture salon");
    expect(draft.lignes[0].prixUnitaire.value).toBe(500);
    expect(draft.lignes[0].quantite.value).toBe(2);
    expect(extractDevisInfoMock).toHaveBeenCalledTimes(2);

    // Un retry du message B (ex. l'envoi de la réponse a échoué) réutilise
    // son propre checkpoint, jamais celui de A ni un nouvel appel.
    const retryB = await resolveExtractionResult("msg_B", extractionInput({ message: "en fait 2m²", currentPendingDevis: draft }), {});
    expect(retryB).toEqual(resultB);
    expect(extractDevisInfoMock).toHaveBeenCalledTimes(2);
  });

  it("un claim 'processing' périmé (worker précédent planté) peut être repris", async () => {
    fakeTable.seed("msg_1", {
      extractionStatus: "processing",
      updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min, au-delà des 5 min de staleness
    });
    extractDevisInfoMock.mockResolvedValue(rawResult("Peinture salon"));

    const result = await resolveExtractionResult("msg_1", extractionInput(), {});

    expect(result.objet).toBe("Peinture salon");
    expect(extractDevisInfoMock).toHaveBeenCalledTimes(1);
  });
});
