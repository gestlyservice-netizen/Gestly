import { describe, expect, it } from "vitest";
import {
  CONDITIONS_DEFAUT,
  ESCOMPTE,
  PENALITES_DEFAUT,
  RESERVE_PROPRIETE,
  documentLegalMentions,
} from "./legal-mentions";

describe("documentLegalMentions", () => {
  it("facture sans paramètres : conditions, escompte et pénalités par défaut", () => {
    const text = documentLegalMentions("facture", null);
    expect(text).toBe(`${CONDITIONS_DEFAUT} ${ESCOMPTE} ${PENALITES_DEFAUT}`);
    expect(text).toContain("40 euros");
    expect(text).toContain("L.441-10");
  });

  it("facture : conditions et pénalités des Paramètres utilisées", () => {
    const text = documentLegalMentions("facture", {
      conditionsPaiement: "Paiement à 30 jours fin de mois.",
      penalitesRetard: "Pénalités : 10 % par an. Indemnité forfaitaire : 40 euros.",
      reservePropriete: false,
    });
    expect(text).toContain("Paiement à 30 jours fin de mois.");
    expect(text).not.toContain(CONDITIONS_DEFAUT);
    expect(text).toContain("Pénalités : 10 % par an.");
    expect(text).not.toContain(PENALITES_DEFAUT);
    expect(text).toContain(ESCOMPTE);
  });

  it("champs vides : retour aux textes par défaut", () => {
    const text = documentLegalMentions("facture", { conditionsPaiement: "  ", penalitesRetard: "" });
    expect(text).toContain(CONDITIONS_DEFAUT);
    expect(text).toContain(PENALITES_DEFAUT);
  });

  it("réserve de propriété imprimée seulement si cochée", () => {
    expect(documentLegalMentions("facture", { reservePropriete: true })).toContain(RESERVE_PROPRIETE);
    expect(documentLegalMentions("facture", { reservePropriete: false })).not.toContain(RESERVE_PROPRIETE);
  });

  it("devis : validité, mentions et invitation à signer", () => {
    const text = documentLegalMentions("devis", { reservePropriete: true }, { validityDays: 30 });
    expect(text.startsWith("Devis valable 30 jours à compter de sa date d'émission.")).toBe(true);
    expect(text).toContain(ESCOMPTE);
    expect(text).toContain(RESERVE_PROPRIETE);
    expect(text).toContain("Pour accepter ce devis");
    expect(documentLegalMentions("devis", null, { validityDays: 1 })).toContain("valable 1 jour à");
  });

  it("avoir : aucune condition de paiement", () => {
    expect(documentLegalMentions("avoir", { reservePropriete: true })).toBe("");
  });
});
