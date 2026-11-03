import { describe, it, expect } from "vitest";
import { factureBalance, summarizeOutstanding } from "@/lib/factures/balance";

// Recette V1 : impayés et reste à encaisser après avoirs.
// Cas constaté en production (2026-11-03) : FAC-2026-001 et FAC-2026-002 à
// 55,36 € émises, AV-2026-001 avoir intégral de FAC-2026-002 → l'écran
// Factures et le tableau de bord affichaient 110,72 € d'impayés au lieu de 55,36 €.

const emise = (totalTTC: number, avoirs: number[] = []) => ({ totalTTC, status: "emise", avoirs: avoirs.map((t) => ({ totalTTC: t })) });
const payee = (totalTTC: number, avoirs: number[] = []) => ({ ...emise(totalTTC, avoirs), status: "payee" });

describe("factureBalance", () => {
  it("sans avoir : tout le TTC reste à encaisser", () => {
    expect(factureBalance(emise(55.36))).toEqual({ credited: 0, net: 55.36, outstanding: 55.36, fullyCredited: false });
  });

  it("avoir intégral : rien à encaisser, facture soldée par avoir", () => {
    expect(factureBalance(emise(55.36, [55.36]))).toEqual({ credited: 55.36, net: 0, outstanding: 0, fullyCredited: true });
  });

  it("avoir partiel : seul le solde reste à encaisser, au centime", () => {
    expect(factureBalance(emise(55.36, [12]))).toMatchObject({ credited: 12, net: 43.36, outstanding: 43.36, fullyCredited: false });
    // 0,1 + 0,2 en flottants = 0,30000000000000004
    expect(factureBalance(emise(1, [0.1, 0.2])).outstanding).toBe(0.7);
  });

  it("plusieurs avoirs partiels couvrant toute la facture : soldée", () => {
    expect(factureBalance(emise(55.36, [20, 35.36]))).toMatchObject({ outstanding: 0, fullyCredited: true });
  });

  it("facture payée : aucun impayé, même avec un avoir émis après paiement (remboursement)", () => {
    expect(factureBalance(payee(55.36))).toMatchObject({ outstanding: 0, net: 55.36 });
    expect(factureBalance(payee(55.36, [10]))).toMatchObject({ outstanding: 0, net: 45.36, credited: 10 });
  });

  it("jamais de solde négatif", () => {
    expect(factureBalance(emise(10, [10.004])).net).toBe(0);
  });

  it("avoirs absents (null) : traités comme aucun avoir", () => {
    expect(factureBalance({ totalTTC: 20, status: "emise", avoirs: null }).outstanding).toBe(20);
  });
});

describe("summarizeOutstanding", () => {
  it("[régression] cas de production : 55,36 € d'impayés, une seule facture en attente (avant : 110,72 €)", () => {
    const fac1 = { number: "FAC-2026-001", ...emise(55.36) };
    const fac2 = { number: "FAC-2026-002", ...emise(55.36, [55.36]) };
    const s = summarizeOutstanding([fac1, fac2]);
    expect(s.total).toBe(55.36);
    expect(s.count).toBe(1);
    expect(s.pending.map((p) => p.facture.number)).toEqual(["FAC-2026-001"]);
  });

  it("mélange émise / partielle / payée / soldée", () => {
    const s = summarizeOutstanding([emise(100), emise(100, [30]), payee(100), emise(50, [50])]);
    expect(s.total).toBe(170);
    expect(s.count).toBe(2);
  });
});
