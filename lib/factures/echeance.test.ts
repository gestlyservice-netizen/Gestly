import { describe, it, expect } from "vitest";
import { defaultDueDateIso, joursDeRetard, parseDueDate, statutFacture } from "@/lib/factures/echeance";

const at = (iso: string) => new Date(iso);

describe("defaultDueDateIso — échéance proposée à émission + 30 jours", () => {
  it("30 jours après la date d'émission, au jour de Paris", () => {
    expect(defaultDueDateIso(at("2026-11-03T10:00:00Z"))).toBe("2026-12-03");
    // 3 novembre 00:30 à Paris = 2 novembre 23:30 UTC : le jour retenu est celui de Paris.
    expect(defaultDueDateIso(at("2026-11-02T23:30:00Z"))).toBe("2026-12-03");
  });
});

describe("parseDueDate — échéance d'une nouvelle facture", () => {
  const issued = at("2026-11-03T10:00:00Z");

  it("obligatoire", () => {
    for (const v of [undefined, null, ""]) expect(parseDueDate(v, issued)).toEqual({ ok: false, error: "Date d'échéance obligatoire" });
  });

  it("format invalide ou date inexistante refusés", () => {
    for (const v of ["pas-une-date", "03/12/2026", "2026-02-30", 20261203]) {
      expect(parseDueDate(v, issued)).toEqual({ ok: false, error: "Date d'échéance invalide" });
    }
  });

  it("antérieure à l'émission refusée ; le jour même et après acceptés (enregistrée à minuit UTC)", () => {
    expect(parseDueDate("2026-11-02", issued)).toMatchObject({ ok: false, error: expect.stringContaining("précéder") });
    expect(parseDueDate("2026-11-03", issued)).toEqual({ ok: true, date: at("2026-11-03T00:00:00.000Z") });
    expect(parseDueDate("2026-12-03", issued)).toEqual({ ok: true, date: at("2026-12-03T00:00:00.000Z") });
    expect(parseDueDate("2026-12-03T00:00:00.000Z", issued)).toMatchObject({ ok: true });
  });
});

describe("joursDeRetard et statutFacture — une seule définition du retard", () => {
  const due = at("2026-12-03T00:00:00.000Z");
  const emise = (extra = {}) => ({ status: "emise", totalTTC: 120, avoirs: [], dueDate: due, ...extra });

  it("jour de l'échéance : 0 jour, pas en retard ; le lendemain : 1 jour, en retard", () => {
    expect(joursDeRetard(due, at("2026-12-03T18:00:00Z"))).toBe(0);
    expect(statutFacture(emise(), at("2026-12-03T18:00:00Z"))).toEqual({ statut: "emise", joursRetard: null });
    expect(statutFacture(emise(), at("2026-12-04T08:00:00Z"))).toEqual({ statut: "en_retard", joursRetard: 1 });
    expect(statutFacture(emise(), at("2026-12-24T08:00:00Z"))).toEqual({ statut: "en_retard", joursRetard: 21 });
  });

  it("[régression] ancienne facture sans échéance : jamais « En retard » (avant : en retard après 30 jours, mais jamais relancée)", () => {
    expect(joursDeRetard(null)).toBeNull();
    expect(statutFacture(emise({ dueDate: null }), at("2027-06-01T00:00:00Z")).statut).toBe("emise");
  });

  it("payée ou soldée par avoir : jamais en retard", () => {
    const late = at("2027-01-30T00:00:00Z");
    expect(statutFacture(emise({ status: "payee" }), late).statut).toBe("payee");
    expect(statutFacture(emise({ avoirs: [{ totalTTC: 120 }] }), late).statut).toBe("soldee");
    expect(statutFacture(emise({ avoirs: [{ totalTTC: 20 }] }), late).statut).toBe("en_retard");
  });
});
