import { describe, it, expect } from "vitest";
import { emptyPendingDevis, applyStuckTracking, applyExtractionToPendingDevis, type RawExtraction } from "@/lib/whatsapp/pending-devis";

function rawIntent(intent: RawExtraction["intent"]): RawExtraction {
  return {
    intent,
    reponseConfirmation: null,
    client: { nom: null, telephone: null, email: null, adresse: null },
    objet: null,
    descriptionTravaux: null,
    lignes: [],
    montantMentionne: null,
    notes: null,
    plusieursDevisDetectes: false,
    ambiguites: [],
  };
}

describe("applyStuckTracking — escalade après blocage conversationnel (test requis #14)", () => {
  it("atteint 'escalated' exactement au Nème tour bloqué consécutif, jamais avant", () => {
    let p = emptyPendingDevis();
    const maxTurns = 3;

    p = applyStuckTracking(p, rawIntent("hors_sujet"), maxTurns);
    expect(p.stuckTurns).toBe(1);
    expect(p.escalated).toBe(false);

    p = applyStuckTracking(p, rawIntent("incomprehensible"), maxTurns);
    expect(p.stuckTurns).toBe(2);
    expect(p.escalated).toBe(false);

    p = applyStuckTracking(p, rawIntent("hors_sujet"), maxTurns);
    expect(p.stuckTurns).toBe(3);
    expect(p.escalated).toBe(true);
  });

  it("une vraie progression (intent=devis) réinitialise le compteur et lève l'escalade", () => {
    let p = emptyPendingDevis();
    p = applyStuckTracking(p, rawIntent("hors_sujet"), 3);
    p = applyStuckTracking(p, rawIntent("hors_sujet"), 3);
    p = applyStuckTracking(p, rawIntent("hors_sujet"), 3);
    expect(p.escalated).toBe(true);

    p = applyStuckTracking(p, rawIntent("devis"), 3);
    expect(p.stuckTurns).toBe(0);
    expect(p.escalated).toBe(false);
  });

  it("reste 'escalated' tant qu'aucune progression n'a eu lieu, sans jamais redescendre seul", () => {
    let p = emptyPendingDevis();
    for (let i = 0; i < 5; i++) {
      p = applyStuckTracking(p, rawIntent("hors_sujet"), 3);
    }
    expect(p.escalated).toBe(true);
    expect(p.stuckTurns).toBe(5);
  });

  it("une confirmation (oui/non) n'incrémente pas le compteur de blocage", () => {
    let p = emptyPendingDevis();
    p = applyStuckTracking(p, rawIntent("confirmation"), 3);
    expect(p.stuckTurns).toBe(0);
    expect(p.escalated).toBe(false);
  });
});

describe("applyExtractionToPendingDevis — téléphone donné après le nom (régression)", () => {
  const withClient = (nom: string | null, telephone: string | null): RawExtraction => ({
    ...rawIntent("devis"),
    client: { nom, telephone, email: null, adresse: null },
  });

  it("relance la recherche quand un téléphone arrive après un nom sans correspondance", async () => {
    const calls: [string | null, string | null][] = [];
    const resolve = async (name: string | null, phone: string | null) => {
      calls.push([name, phone]);
      return phone
        ? { matchedClientId: "client_existant", matchStatus: "unique_match" as const, ambiguousCandidates: [] }
        : { matchedClientId: null, matchStatus: "no_match" as const, ambiguousCandidates: [] };
    };

    let p = await applyExtractionToPendingDevis(emptyPendingDevis(), withClient("Mme Martin", null), 20, resolve);
    expect(p.client).toMatchObject({ matchStatus: "no_match", matchedClientId: null });

    p = await applyExtractionToPendingDevis(p, withClient(null, "06 22 22 22 22"), 20, resolve);
    expect(calls).toEqual([["Mme Martin", null], ["Mme Martin", "06 22 22 22 22"]]);
    expect(p.client).toMatchObject({ matchStatus: "unique_match", matchedClientId: "client_existant", nomMentionne: "Mme Martin" });
  });

  it("lève une ambiguïté de nom grâce au téléphone", async () => {
    const candidates = [{ id: "c1", name: "Jean Dupont", phone: null }, { id: "c2", name: "Jean Dupont", phone: null }];
    const resolve = async (_name: string | null, phone: string | null) =>
      phone
        ? { matchedClientId: "c2", matchStatus: "unique_match" as const, ambiguousCandidates: [] }
        : { matchedClientId: null, matchStatus: "ambiguous" as const, ambiguousCandidates: candidates };

    let p = await applyExtractionToPendingDevis(emptyPendingDevis(), withClient("Jean Dupont", null), 20, resolve);
    expect(p.client.matchStatus).toBe("ambiguous");
    p = await applyExtractionToPendingDevis(p, withClient(null, "06 44 44 44 44"), 20, resolve);
    expect(p.client).toMatchObject({ matchStatus: "unique_match", matchedClientId: "c2", ambiguousCandidates: [] });
  });

  it("ne remet jamais en cause une correspondance unique déjà établie", async () => {
    let calls = 0;
    const resolve = async () => {
      calls++;
      return { matchedClientId: "c1", matchStatus: "unique_match" as const, ambiguousCandidates: [] };
    };
    let p = await applyExtractionToPendingDevis(emptyPendingDevis(), withClient("Jean Dupont", null), 20, resolve);
    p = await applyExtractionToPendingDevis(p, withClient(null, "06 99 99 99 99"), 20, resolve);
    expect(calls).toBe(1);
    expect(p.client.matchedClientId).toBe("c1");
  });
});
