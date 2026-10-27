import { describe, it, expect } from "vitest";
import { computeDocumentLines, computeTotals, previewTotals } from "./totals";

const line = (quantity: unknown, unitPriceHT: unknown, tvaRate: unknown = 20, description: unknown = "Prestation") =>
  ({ description, quantity, unitPriceHT, tvaRate });

describe("computeDocumentLines — calcul", () => {
  it("[régression] 3 × 0,10 € : 0,30 € exactement (aucune dérive de virgule flottante)", () => {
    const r = computeDocumentLines([line(3, 0.1)]);
    expect(r.ok && r.totalHT).toBe(0.3);
    expect(r.ok && r.lines[0].totalHT).toBe(0.3);
    expect(r.ok && r.totalTTC).toBe(0.36);
  });

  it("taux mixtes : TVA par taux, arrondie au centime, TTC = HT + TVA", () => {
    const r = computeDocumentLines([line(1.5, 33.33, 20), line(2, 19.99, 5.5), line(1, 10, 10), line(3, 7.77, 0)]);
    if (!r.ok) throw new Error(r.error);
    // 50,00 (49,995 arrondi) + 39,98 + 10,00 + 23,31
    expect(r.lines.map((l) => l.totalHT)).toEqual([50, 39.98, 10, 23.31]);
    expect(r.totalHT).toBe(123.29);
    // 20 % de 50,00 = 10,00 ; 5,5 % de 39,98 = 2,1989 → 2,20 ; 10 % de 10 = 1,00 ; 0
    expect(r.totalTVA).toBe(13.2);
    expect(r.totalTTC).toBe(136.49);
  });

  it("deux lignes au même taux : TVA calculée sur la base cumulée", () => {
    const r = computeDocumentLines([line(1, 0.05, 10), line(1, 0.05, 10)]);
    // base 0,10 € → TVA 0,01 € (et non 0 + 0 en arrondissant chaque ligne)
    expect(r.ok && r.totalTVA).toBe(0.01);
  });

  it("taux absent : 20 % par défaut (avant : NaN dans les totaux des factures)", () => {
    const r = computeDocumentLines([{ description: "Pose", quantity: 2, unitPriceHT: 50 }]);
    expect(r.ok && r.lines[0].tvaRate).toBe(20);
    expect(r.ok && r.totalTTC).toBe(120);
  });

  it("nombres reçus en texte (virgule ou point) acceptés", () => {
    const r = computeDocumentLines([line("2,5", "10.40", "5.5")]);
    expect(r.ok && r.totalHT).toBe(26);
  });

  it("gros montants : centimes exacts", () => {
    const r = computeDocumentLines([line(1234.5, 987.65, 20)]);
    expect(r.ok && r.totalHT).toBe(1219253.93);
    expect(r.ok && r.totalTTC).toBe(1463104.72);
  });
});

describe("computeDocumentLines — validation serveur", () => {
  it.each([
    [[], "Au moins une ligne requise"],
    [null, "Au moins une ligne requise"],
    [[line(1, 10, 20, "  ")], "Ligne 1 : description requise"],
    [[line(1, 10), line(0, 10)], "Ligne 2 : quantité invalide"],
    [[line(-2, 10)], "Ligne 1 : quantité invalide"],
    [[line("abc", 10)], "Ligne 1 : quantité invalide"],
    [[line(1, -5)], "Ligne 1 : prix unitaire invalide"],
    [[line(1, undefined)], "Ligne 1 : prix unitaire invalide"],
    [[line(1, Infinity)], "Ligne 1 : prix unitaire invalide"],
    [[line(1, 10, 150)], "Ligne 1 : taux de TVA invalide"],
    [[line(1, 10, -1)], "Ligne 1 : taux de TVA invalide"],
    [[line(1, 10, "x")], "Ligne 1 : taux de TVA invalide"],
  ])("refuse %j", (input, error) => {
    expect(computeDocumentLines(input)).toEqual({ ok: false, error });
  });

  it("description nettoyée des espaces", () => {
    const r = computeDocumentLines([line(1, 1, 20, "  Peinture  ")]);
    expect(r.ok && r.lines[0].description).toBe("Peinture");
  });
});

describe("aperçu des formulaires", () => {
  it("identique au calcul serveur pour des lignes valides", () => {
    const lines = [line(1.5, 33.33, 20), line(2, 19.99, 5.5)];
    const server = computeDocumentLines(lines);
    const preview = previewTotals(lines);
    expect(server.ok && { totalHT: server.totalHT, totalTVA: server.totalTVA, totalTTC: server.totalTTC })
      .toEqual({ totalHT: preview.totalHT, totalTVA: preview.totalTVA, totalTTC: preview.totalTTC });
  });

  it("saisie en cours (champs vides) : 0, jamais NaN", () => {
    const p = previewTotals([{ description: "", quantity: "", unitPriceHT: undefined, tvaRate: 20 }]);
    expect(p).toEqual({ lineTotals: [0], totalHT: 0, totalTVA: 0, totalTTC: 0 });
    expect(computeTotals([]).totalTTC).toBe(0);
  });
});
