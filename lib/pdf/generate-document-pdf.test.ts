import { describe, it, expect } from "vitest";
import { generateDevisPdfBuffer, generateDocumentPdfBuffer } from "@/lib/pdf/generate-document-pdf";

// Génération RÉELLE du PDF (jsPDF, aucun mock), avec des données fictives —
// c'est le fichier joint au devis envoyé par WhatsApp (lib/whatsapp/send-devis.ts).

const devis = {
  number: "DEV-2026-042",
  createdAt: new Date("2026-10-01T10:00:00Z"),
  validityDays: 30,
  notes: "Accès par la cour. Prévoir bâche de protection.",
  totalHT: 1450,
  totalTVA: 290,
  totalTTC: 1740,
};
const lines = [
  { description: "Peinture salon (murs et plafond), 2 couches", quantity: 1, unitPriceHT: 1200, tvaRate: 20, totalHT: 1200 },
  { description: "Rebouchage fissures — enduit fibré", quantity: 5, unitPriceHT: 50, tvaRate: 20, totalHT: 250 },
];
const client = { name: "Mme Élodie Martin", address: "12 rue des Lilas, 69000 Lyon", email: "client@example.com", phone: "06 22 22 22 22" };
const settings = {
  companyName: "Peinture Fictive SARL",
  formeJuridique: "SARL",
  siret: "000 000 000 00000",
  adresseRue: "1 avenue de l'Exemple",
  codePostal: "69001",
  ville: "Lyon",
  telephone: "04 00 00 00 00",
  emailPro: "contact@example.com",
  couleurPrincipale: "#0F766E",
  piedDePage: "Devis gratuit — pénalités de retard selon CGV.",
};

function asText(buf: Buffer): string {
  return buf.toString("latin1");
}

describe("generateDevisPdfBuffer — PDF réel", () => {
  it("produit un document PDF complet et non vide", () => {
    const pdf = generateDevisPdfBuffer(devis, lines, client, settings);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(2000);
    expect(asText(pdf.subarray(0, 8))).toMatch(/^%PDF-1\.\d/);
    expect(asText(pdf).trimEnd()).toMatch(/%%EOF$/);
    expect(asText(pdf)).toMatch(/\/Type \/Page\b/);
  });

  it("contient le numéro du devis, le client et les montants formatés", () => {
    const text = asText(generateDevisPdfBuffer(devis, lines, client, settings));

    expect(text).toContain("DEV-2026-042");
    expect(text).toContain("DEVIS");
    expect(text).toContain("Peinture Fictive SARL");
    expect(text).toContain("(1 740,00 "); // total TTC lisible, espace insécable classique
  });

  it("[régression] montants ≥ 1 000 € : aucune chaîne réencodée en 16 bits (texte corrompu)", () => {
    const text = asText(generateDevisPdfBuffer({ ...devis, totalTTC: 1234567.89 }, lines, client, settings));
    // jsPDF bascule une chaîne entière en 16 bits (octets nuls intercalés)
    // dès qu'un caractère n'est pas encodable — ex. l'espace fine U+202F.
    expect(text).not.toMatch(/\(\u0000/);
    expect(text).toContain("(1 234 567,89 ");
  });

  it("fonctionne sans paramètres d'entreprise ni notes (compte neuf)", () => {
    const pdf = generateDevisPdfBuffer({ ...devis, notes: null }, lines, { name: "Client Fictif" }, null);
    expect(asText(pdf.subarray(0, 5))).toBe("%PDF-");
  });

  it("[régression] 60 lignes : pagination, chaque ligne et les totaux restent dans une page", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      description: `Ligne fictive ${i + 1}`, quantity: 1, unitPriceHT: 10, tvaRate: 20, totalHT: 10,
    }));
    const text = asText(generateDevisPdfBuffer({ ...devis, totalHT: 600, totalTVA: 120, totalTTC: 720 }, many, client, settings));

    const pages = (text.match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(1);

    // Position verticale (points PDF, origine en bas de la page A4 = 841,89 pt)
    // de chaque texte dessiné : avant correction, 32 lignes sur 60 et les
    // totaux étaient dessinés hors de la page (y négatif), donc invisibles.
    const yOf = (label: string) => {
      const m = text.match(new RegExp(`([\\d.-]+) ([\\d.-]+) Td\\n\\(${label}\\) Tj`));
      return m ? Number(m[2]) : null;
    };
    const ys = many.map((l) => yOf(l.description));
    expect(ys.every((y) => y !== null && y > 0 && y < 841.89)).toBe(true);
    const totalY = yOf("Total TTC");
    expect(totalY).not.toBeNull();
    expect(totalY!).toBeGreaterThan(0);
    // Pied de page avec numérotation sur chaque page.
    expect(text).toContain(`(DEV-2026-042 — page ${pages}/${pages})`.replace("—", "\u0097"));
  });

  it("le générateur commun produit aussi factures et avoirs", () => {
    const pdf = generateDocumentPdfBuffer({
      docTypeLabel: "FACTURE", number: "FAC-2026-007", metaLines: [{ label: "Date", value: "01/10/2026" }],
      client, lines, totalHT: 1450, totalTVA: 290, totalTTC: 1740, settings,
    });
    expect(asText(pdf)).toContain("FAC-2026-007");
  });

  it("[régression] facture : conditions de paiement, escompte et réserve de propriété des Paramètres imprimées", () => {
    const text = asText(generateDocumentPdfBuffer({
      docTypeLabel: "FACTURE", number: "FAC-2026-008", metaLines: [], client, lines,
      totalHT: 1450, totalTVA: 290, totalTTC: 1740,
      settings: { ...settings, conditionsPaiement: "Paiement à 30 jours.", reservePropriete: true },
    }));
    // Avant correction : « Règlement à réception » en dur, réglages ignorés.
    expect(text).toContain("Paiement à 30 jours.");
    expect(text).not.toContain("Règlement à réception");
    expect(text).toContain("escompte");
    expect(text).toContain("serve de propri"); // « réserve de propriété », coupure de ligne possible
    // Toutes les lignes du pied de page restent dans la page (y > 0).
    const ys = Array.from(text.matchAll(/[\d.-]+ ([\d.-]+) Td/g), (m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThan(0);
  });

  it("avoir : aucune condition de paiement imprimée", () => {
    const text = asText(generateDocumentPdfBuffer({
      docTypeLabel: "AVOIR", number: "AV-2026-001", metaLines: [], client, lines,
      totalHT: 100, totalTVA: 20, totalTTC: 120, settings: { ...settings, reservePropriete: true },
    }));
    expect(text).not.toContain("escompte");
    expect(text).not.toContain("40 euros");
  });
});
