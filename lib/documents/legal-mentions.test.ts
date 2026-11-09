import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  CONDITIONS_DEFAUT,
  ESCOMPTE,
  PENALITES_DEFAUT,
  RESERVE_PROPRIETE,
  conditionsPaiement,
  documentLegalMentions,
  echeanceUlterieure,
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

// Décision utilisateur (2026-11-09) : jamais « à réception » si une échéance
// postérieure à l'émission est définie ; toutes les autres mentions restent.

describe.each(["UTC", "Europe/Paris"])("[régression] conditions de paiement et échéance — serveur en %s", (tz) => {
  const savedTz = process.env.TZ;
  beforeEach(() => { process.env.TZ = tz; });
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });
  const issuedAt = new Date("2026-11-09T10:00:00Z");
  const dueDate = new Date("2026-12-09T00:00:00.000Z"); // enregistrée à minuit UTC (parseDueDate)

  it("échéance ultérieure, sans paramètres : date d'échéance, jamais « à réception »", () => {
    const text = documentLegalMentions("facture", null, { issuedAt, dueDate });
    expect(text).not.toMatch(/r[ée]ception/i);
    expect(text).toContain("Date d'échéance du paiement : 09/12/2026.");
    // Les autres mentions obligatoires restent.
    expect(text).toContain(ESCOMPTE);
    expect(text).toContain(PENALITES_DEFAUT);
  });

  it("échéance ultérieure et conditions enregistrées « Règlement à réception de facture. » (préremplies) : écartées", () => {
    const text = documentLegalMentions("facture", { conditionsPaiement: CONDITIONS_DEFAUT, reservePropriete: true }, { issuedAt, dueDate });
    expect(text).not.toMatch(/r[ée]ception/i);
    expect(text).toContain(RESERVE_PROPRIETE);
  });

  it.each(["Paiement à reception.", "RÈGLEMENT À RÉCEPTION", "Payable dès réception par chèque"])(
    "conditions personnalisées mentionnant la réception (%s) : écartées", (conditions) => {
      expect(conditionsPaiement({ conditionsPaiement: conditions }, { issuedAt, dueDate })).toBe("Date d'échéance du paiement : 09/12/2026.");
    });

  it("conditions personnalisées compatibles : conservées après la date d'échéance", () => {
    expect(conditionsPaiement({ conditionsPaiement: "Paiement par virement (IBAN FR76 fictif)." }, { issuedAt, dueDate }))
      .toBe("Date d'échéance du paiement : 09/12/2026. Paiement par virement (IBAN FR76 fictif).");
  });

  it("échéance le jour de l'émission, ou absente : conditions habituelles (« à réception » autorisé)", () => {
    expect(conditionsPaiement(null, { issuedAt, dueDate: new Date("2026-11-09T00:00:00.000Z") })).toBe(CONDITIONS_DEFAUT);
    expect(conditionsPaiement(null, { issuedAt, dueDate: null })).toBe(CONDITIONS_DEFAUT);
    expect(conditionsPaiement({ conditionsPaiement: "À 45 jours fin de mois." }, { issuedAt })).toBe("À 45 jours fin de mois.");
  });

  it("minuit : facture émise le 04/11 à 0 h 30 à Paris (03/11 23 h 30 UTC), échéance le 04/11 = même jour", () => {
    const emiseMinuit = new Date("2026-11-03T23:30:00Z");
    expect(echeanceUlterieure({ issuedAt: emiseMinuit, dueDate: "2026-11-04" })).toBeNull();
    expect(echeanceUlterieure({ issuedAt: emiseMinuit, dueDate: "2026-11-05" })).toBe("2026-11-05");
    // Ancien calcul en UTC : 03/11 < 04/11 → « ultérieure » à tort.
  });

  it("passage à l'heure d'hiver : émise le 25/10 à 2 h 30 (heure répétée), échéance le 24/11", () => {
    expect(conditionsPaiement(null, { issuedAt: new Date("2026-10-25T01:30:00Z"), dueDate: new Date("2026-11-24T00:00:00.000Z") }))
      .toBe("Date d'échéance du paiement : 24/11/2026.");
  });

  it("devis et avoir : inchangés (pas d'échéance sur un devis, aucune condition sur un avoir)", () => {
    expect(documentLegalMentions("devis", null, { validityDays: 30, issuedAt, dueDate })).toContain(CONDITIONS_DEFAUT);
    expect(documentLegalMentions("avoir", null, { issuedAt, dueDate })).toBe("");
  });

  it("formulaire (AAAA-MM-JJ) et PDF (instant enregistré) : même mention", () => {
    expect(conditionsPaiement(null, { issuedAt, dueDate: "2026-12-09" })).toBe(conditionsPaiement(null, { issuedAt, dueDate }));
  });
});

describe("[régression] même règle partout : PDF, impression, formulaires, email", () => {
  it("chaque point d'affichage transmet émission et échéance à la règle unique", async () => {
    const { readFileSync } = await import("node:fs");
    const src = (p: string) => readFileSync(p, "utf8");
    expect(src("app/print/factures/[id]/page.tsx")).toContain("dueDate: facture.dueDate");
    expect(src("lib/pdf/generate-document-pdf.ts")).toMatch(/issuedAt: facture\.createdAt,\s+dueDate: facture\.dueDate/);
    expect(src("app/dashboard/factures/nouveau/page.tsx")).toContain("<MentionEcheance");
    expect(src("app/dashboard/devis/[id]/page.tsx")).toContain("<MentionEcheance");
    expect(src("lib/documents/document-email.ts")).toContain("echeanceUlterieure(input)");
  });
});
