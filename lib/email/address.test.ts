import { describe, it, expect } from "vitest";
import { parseEmailAddress } from "@/lib/email/address";

describe("parseEmailAddress", () => {
  it.each([
    "client.test@example.com",
    "prenom+devis@example.fr",
    "o'neil@sous-domaine.example.co.uk",
    "a_b-c@example.com",
  ])("accepte %s", (email) => {
    expect(parseEmailAddress(email)).toBe(email);
  });

  it("retire les espaces de bord", () => {
    expect(parseEmailAddress("  client@example.com \n")).toBe("client@example.com");
  });

  it.each([
    ["vide", ""],
    ["espaces seulement", "   "],
    ["sans @", "client.example.com"],
    ["sans domaine", "client@"],
    ["sans extension", "client@example"],
    ["extension numérique", "client@example.123"],
    ["deux @", "a@b@example.com"],
    ["liste avec virgule", "a@example.com,b@example.com"],
    ["liste avec point-virgule", "a@example.com;b@example.com"],
    ["nom affiché", "Client <client@example.com>"],
    ["espace interne", "cli ent@example.com"],
    ["injection d'en-tête CRLF", "client@example.com\r\nBcc: autre@example.com"],
    ["retour à la ligne interne", "client@exa\nmple.com"],
    ["point en tête", ".client@example.com"],
    ["point final de la partie locale", "client.@example.com"],
    ["points doublés", "cli..ent@example.com"],
    ["label de domaine commençant par un tiret", "client@-example.com"],
    ["trop longue", `${"a".repeat(64)}@${"b".repeat(190)}.com`],
    ["partie locale > 64", `${"a".repeat(65)}@example.com`],
  ])("refuse : %s", (_label, email) => {
    expect(parseEmailAddress(email)).toBeNull();
  });

  it("refuse ce qui n'est pas une chaîne", () => {
    expect(parseEmailAddress(undefined)).toBeNull();
    expect(parseEmailAddress(null)).toBeNull();
    expect(parseEmailAddress(42)).toBeNull();
    expect(parseEmailAddress(["a@example.com"])).toBeNull();
  });
});
