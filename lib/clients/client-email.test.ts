import { describe, it, expect } from "vitest";
import { CLIENT_EMAIL_ERROR, isStoredEmailInvalid, normalizeClientEmail } from "@/lib/clients/client-email";

describe("normalizeClientEmail — création", () => {
  it("vide, blanc, absent : aucune adresse", () => {
    for (const v of [undefined, null, "", "   "]) expect(normalizeClientEmail(v)).toEqual({ ok: true, email: null });
  });

  it("adresse valide : nettoyée", () => {
    expect(normalizeClientEmail("  client.test@example.com ")).toEqual({ ok: true, email: "client.test@example.com" });
  });

  it.each(["client@", "a@example.com, b@example.com", "Nom <a@example.com>", "a@example.com\nBcc: b@example.com", "cli ent@example.com"])(
    "adresse invalide refusée : %s", (v) => {
      expect(normalizeClientEmail(v)).toEqual({ ok: false, error: CLIENT_EMAIL_ERROR });
    });

  it("type inattendu refusé", () => {
    expect(normalizeClientEmail(42).ok).toBe(false);
    expect(normalizeClientEmail(["a@example.com"]).ok).toBe(false);
  });
});

describe("normalizeClientEmail — modification d'un client existant", () => {
  const ancienne = "a@example.com, b@example.com"; // fiche antérieure à la validation

  it("adresse invalide existante, inchangée : conservée telle quelle (modification du nom possible)", () => {
    expect(normalizeClientEmail(ancienne, ancienne)).toEqual({ ok: true, email: ancienne });
    expect(normalizeClientEmail(` ${ancienne} `, ancienne)).toEqual({ ok: true, email: ancienne });
  });

  it("adresse modifiée : doit être valide", () => {
    expect(normalizeClientEmail("a@example.com, c@example.com", ancienne).ok).toBe(false);
    expect(normalizeClientEmail("a@example.com", ancienne)).toEqual({ ok: true, email: "a@example.com" });
  });

  it("adresse effacée : aucune adresse", () => {
    expect(normalizeClientEmail("", ancienne)).toEqual({ ok: true, email: null });
  });
});

describe("isStoredEmailInvalid", () => {
  it("signale une adresse enregistrée inutilisable, pas une adresse absente", () => {
    expect(isStoredEmailInvalid("a@example.com, b@example.com")).toBe(true);
    expect(isStoredEmailInvalid("client@example.com")).toBe(false);
    expect(isStoredEmailInvalid(null)).toBe(false);
    expect(isStoredEmailInvalid("")).toBe(false);
  });
});
