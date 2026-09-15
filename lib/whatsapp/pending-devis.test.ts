import { describe, it, expect } from "vitest";
import { emptyPendingDevis, applyStuckTracking, type RawExtraction } from "@/lib/whatsapp/pending-devis";

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
