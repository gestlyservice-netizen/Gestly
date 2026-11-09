import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { ajouterJours, finValiditeDevis, formatDateParis, formatJourFr, jourParis } from "@/lib/dates/paris";

// Chaque scénario est rejoué avec plusieurs fuseaux de serveur : UTC (Vercel),
// Paris (poste de développement) et deux fuseaux éloignés. Le résultat ne
// doit jamais en dépendre. Node relit process.env.TZ à chaque modification.
const SERVER_TZ = ["UTC", "Europe/Paris", "America/New_York", "Pacific/Kiritimati"];
const savedTz = process.env.TZ;
afterEach(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

describe.each(SERVER_TZ)("serveur en %s", (tz) => {
  beforeEach(() => {
    process.env.TZ = tz;
  });

  it("minuit à Paris en hiver (UTC+1) : 23 h 30 UTC = lendemain à Paris", () => {
    expect(formatDateParis(new Date("2026-11-03T23:30:00Z"))).toBe("04/11/2026");
    expect(formatDateParis(new Date("2026-11-03T22:59:59Z"))).toBe("03/11/2026");
    expect(formatDateParis(new Date("2026-11-03T23:00:00Z"))).toBe("04/11/2026");
  });

  it("minuit à Paris en été (UTC+2) : 22 h 00 UTC = lendemain à Paris", () => {
    expect(formatDateParis(new Date("2026-07-14T21:59:59Z"))).toBe("14/07/2026");
    expect(formatDateParis(new Date("2026-07-14T22:00:00Z"))).toBe("15/07/2026");
  });

  it("Saint-Sylvestre : 31/12 23 h 30 à Paris reste en 2026, 0 h 30 passe en 2027", () => {
    expect(formatDateParis(new Date("2026-12-31T22:30:00Z"))).toBe("31/12/2026");
    expect(formatDateParis(new Date("2026-12-31T23:30:00Z"))).toBe("01/01/2027");
  });

  it("passage à l'heure d'été (29/03/2026, 2 h → 3 h)", () => {
    expect(formatDateParis(new Date("2026-03-28T22:59:00Z"))).toBe("28/03/2026"); // 23 h 59 CET
    expect(formatDateParis(new Date("2026-03-28T23:00:00Z"))).toBe("29/03/2026"); // 0 h 00 CET
    expect(formatDateParis(new Date("2026-03-29T00:59:00Z"))).toBe("29/03/2026"); // 1 h 59 CET
    expect(formatDateParis(new Date("2026-03-29T01:00:00Z"))).toBe("29/03/2026"); // 3 h 00 CEST
    expect(formatDateParis(new Date("2026-03-29T21:59:00Z"))).toBe("29/03/2026"); // 23 h 59 CEST
    expect(formatDateParis(new Date("2026-03-29T22:00:00Z"))).toBe("30/03/2026"); // 0 h 00 CEST
  });

  it("passage à l'heure d'hiver (25/10/2026, 3 h → 2 h)", () => {
    expect(formatDateParis(new Date("2026-10-24T21:59:00Z"))).toBe("24/10/2026"); // 23 h 59 CEST
    expect(formatDateParis(new Date("2026-10-24T22:00:00Z"))).toBe("25/10/2026"); // 0 h 00 CEST
    expect(formatDateParis(new Date("2026-10-25T00:30:00Z"))).toBe("25/10/2026"); // 2 h 30 CEST
    expect(formatDateParis(new Date("2026-10-25T01:30:00Z"))).toBe("25/10/2026"); // 2 h 30 CET (heure répétée)
    expect(formatDateParis(new Date("2026-10-25T22:59:00Z"))).toBe("25/10/2026"); // 23 h 59 CET
    expect(formatDateParis(new Date("2026-10-25T23:00:00Z"))).toBe("26/10/2026"); // 0 h 00 CET
  });

  it("[régression] validité traversant l'heure d'hiver : devis créé à 0 h 30 (heure d'été)", () => {
    // 20/10/2026 0 h 30 CEST = 19/10 22 h 30 UTC. + 30 jours = 19/11/2026.
    // Ancien calcul (setDate en UTC) : 18/11 22 h 30 UTC = 18/11 23 h 30 CET → 18/11 (un jour de moins).
    expect(finValiditeDevis(new Date("2026-10-19T22:30:00Z"), 30)).toBe("2026-11-19");
    // Preuve que le fuseau du serveur est bien simulé : l'ancien calcul
    // reproduit l'anomalie sous UTC (Vercel) et pas sous Paris.
    const old = new Date("2026-10-19T22:30:00Z");
    old.setDate(old.getDate() + 30);
    if (tz === "UTC") expect(old.toLocaleDateString("fr-FR")).toBe("18/11/2026");
    if (tz === "Europe/Paris") expect(old.toLocaleDateString("fr-FR")).toBe("19/11/2026");
  });

  it("validité traversant l'heure d'été : devis créé à 23 h 30 (heure d'hiver)", () => {
    // 20/03/2026 23 h 30 CET = 22 h 30 UTC. + 30 jours = 19/04/2026.
    expect(finValiditeDevis(new Date("2026-03-20T22:30:00Z"), 30)).toBe("2026-04-19");
  });

  it("validité : fins de mois, année bissextile, durée nulle", () => {
    expect(finValiditeDevis(new Date("2026-01-31T10:00:00Z"), 30)).toBe("2026-03-02");
    expect(finValiditeDevis(new Date("2028-02-28T10:00:00Z"), 1)).toBe("2028-02-29");
    expect(finValiditeDevis(new Date("2026-12-15T10:00:00Z"), 30)).toBe("2027-01-14");
    expect(finValiditeDevis(new Date("2026-11-03T10:00:00Z"), 0)).toBe("2026-11-03");
  });

  it("échéance enregistrée à minuit UTC (parseDueDate) : même jour affiché", () => {
    expect(formatDateParis(new Date("2026-12-03T00:00:00.000Z"))).toBe("03/12/2026");
    expect(formatDateParis(new Date("2026-07-03T00:00:00.000Z"))).toBe("03/07/2026");
  });

  it("chaîne ISO acceptée", () => {
    expect(jourParis("2026-11-03T23:30:00Z")).toBe("2026-11-04");
  });
});

describe("ajouterJours / formatJourFr", () => {
  it("compte en jours calendaires, y compris en arrière", () => {
    expect(ajouterJours("2026-10-24", 2)).toBe("2026-10-26");
    expect(ajouterJours("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("refuse un jour mal formé", () => {
    expect(() => ajouterJours("03/11/2026", 1)).toThrow(RangeError);
    expect(() => formatJourFr("2026-1-3")).toThrow(RangeError);
  });

  it("formatJourFr", () => {
    expect(formatJourFr("2026-01-05")).toBe("05/01/2026");
  });
});
