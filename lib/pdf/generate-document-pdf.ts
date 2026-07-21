import { jsPDF } from "jspdf";

// Générateur de PDF vectoriel côté serveur (texte sélectionnable, poids réduit)
// — utilisé pour les pièces jointes email (facture, avoir) où html2canvas
// (DOM navigateur) n'est pas disponible en environnement Node/serverless.
// Le rendu diffère volontairement du PDF "capture d'écran" existant côté
// dashboard : plus sobre, mais fonctionnellement complet et conforme.

export interface DocumentPdfLine {
  description: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
  totalHT: number;
}

export interface DocumentPdfSettings {
  companyName: string;
  formeJuridique?: string | null;
  siret?: string | null;
  tvaIntracom?: string | null;
  adresseRue?: string | null;
  codePostal?: string | null;
  ville?: string | null;
  telephone?: string | null;
  emailPro?: string | null;
  couleurPrincipale?: string | null;
  piedDePage?: string | null;
  penalitesRetard?: string | null;
}

export interface DocumentPdfClient {
  name: string;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface DocumentPdfOptions {
  docTypeLabel: string; // "FACTURE" | "AVOIR" | "DEVIS"
  number: string;
  metaLines: { label: string; value: string }[];
  client: DocumentPdfClient;
  lines: DocumentPdfLine[];
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  notes?: string | null;
  extraNote?: string | null;
  settings: DocumentPdfSettings | null;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [37, 99, 235];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function generateDocumentPdfBuffer(opts: DocumentPdfOptions): Buffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const [r, g, b] = hexToRgb(opts.settings?.couleurPrincipale ?? "#2563EB");
  const marginX = 20;
  const pageWidth = 210;
  const contentWidth = pageWidth - marginX * 2;
  let y = 22;

  // ── En-tête ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(r, g, b);
  doc.text(opts.settings?.companyName || "Mon Entreprise", marginX, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  y += 5.5;
  const companyLines = [
    opts.settings?.formeJuridique,
    opts.settings?.adresseRue,
    [opts.settings?.codePostal, opts.settings?.ville].filter(Boolean).join(" "),
    opts.settings?.telephone,
    opts.settings?.emailPro,
    opts.settings?.siret ? `SIRET : ${opts.settings.siret}` : null,
    opts.settings?.tvaIntracom ? `TVA : ${opts.settings.tvaIntracom}` : null,
  ].filter(Boolean) as string[];
  for (const line of companyLines) {
    doc.text(line, marginX, y);
    y += 4.2;
  }

  // Titre document (droite)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(30, 30, 30);
  doc.text(opts.docTypeLabel, pageWidth - marginX, 22, { align: "right" });
  doc.setFontSize(12);
  doc.setTextColor(r, g, b);
  doc.text(opts.number, pageWidth - marginX, 29, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  let metaY = 35;
  for (const meta of opts.metaLines) {
    doc.text(`${meta.label} : ${meta.value}`, pageWidth - marginX, metaY, { align: "right" });
    metaY += 4.2;
  }

  y = Math.max(y, metaY) + 8;

  // ── Client ──
  doc.setFillColor(248, 250, 252);
  const clientBoxHeight = 8 + 5 * 4.2;
  doc.roundedRect(pageWidth - marginX - 70, y, 70, clientBoxHeight, 2, 2, "F");
  let cy = y + 6;
  doc.setFontSize(7.5);
  doc.setTextColor(150, 150, 150);
  doc.text("DESTINATAIRE", pageWidth - marginX - 65, cy);
  cy += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text(opts.client.name, pageWidth - marginX - 65, cy);
  cy += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  for (const line of [opts.client.address, opts.client.email, opts.client.phone].filter(Boolean) as string[]) {
    doc.text(line, pageWidth - marginX - 65, cy);
    cy += 4;
  }

  y += clientBoxHeight + 10;

  // ── Tableau des lignes ──
  const colWidths = [contentWidth * 0.42, contentWidth * 0.13, contentWidth * 0.17, contentWidth * 0.1, contentWidth * 0.18];
  const colX = [marginX];
  for (let i = 0; i < colWidths.length - 1; i++) colX.push(colX[i] + colWidths[i]);

  doc.setFillColor(r, g, b);
  doc.rect(marginX, y, contentWidth, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(255, 255, 255);
  doc.text("Description", colX[0] + 2, y + 5.3);
  doc.text("Qté", colX[1] + colWidths[1] - 2, y + 5.3, { align: "right" });
  doc.text("Prix HT", colX[2] + colWidths[2] - 2, y + 5.3, { align: "right" });
  doc.text("TVA", colX[3] + colWidths[3] - 2, y + 5.3, { align: "right" });
  doc.text("Total HT", colX[4] + colWidths[4] - 2, y + 5.3, { align: "right" });
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  for (let i = 0; i < opts.lines.length; i++) {
    const line = opts.lines[i];
    const rowHeight = 7;
    if (i % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, contentWidth, rowHeight, "F");
    }
    doc.setTextColor(50, 50, 50);
    const desc = doc.splitTextToSize(line.description, colWidths[0] - 4)[0] as string;
    doc.text(desc, colX[0] + 2, y + 4.8);
    doc.setTextColor(90, 90, 90);
    doc.text(String(line.quantity), colX[1] + colWidths[1] - 2, y + 4.8, { align: "right" });
    doc.text(`${fmt(line.unitPriceHT)} €`, colX[2] + colWidths[2] - 2, y + 4.8, { align: "right" });
    doc.text(`${line.tvaRate} %`, colX[3] + colWidths[3] - 2, y + 4.8, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text(`${fmt(line.totalHT)} €`, colX[4] + colWidths[4] - 2, y + 4.8, { align: "right" });
    doc.setFont("helvetica", "normal");
    y += rowHeight;
  }
  y += 8;

  // ── Totaux ──
  const totalsBoxX = pageWidth - marginX - 70;
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text("Total HT", totalsBoxX, y);
  doc.text(`${fmt(opts.totalHT)} €`, pageWidth - marginX, y, { align: "right" });
  y += 5.5;
  doc.text("Total TVA", totalsBoxX, y);
  doc.text(`${fmt(opts.totalTVA)} €`, pageWidth - marginX, y, { align: "right" });
  y += 4;

  doc.setFillColor(r, g, b);
  doc.rect(totalsBoxX, y, 70, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text("Total TTC", totalsBoxX + 3, y + 6);
  doc.setFontSize(12);
  doc.text(`${fmt(opts.totalTTC)} €`, pageWidth - marginX - 3, y + 6.2, { align: "right" });
  y += 16;

  // ── Notes / note complémentaire (ex: raison d'avoir) ──
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 90);
  if (opts.extraNote) {
    doc.text(doc.splitTextToSize(opts.extraNote, contentWidth), marginX, y);
    y += 10;
  }
  if (opts.notes) {
    doc.text(doc.splitTextToSize(opts.notes, contentWidth), marginX, y);
    y += 10;
  }

  // ── Pied de page / mentions légales ──
  const footerY = 275;
  doc.setDrawColor(226, 232, 240);
  doc.line(marginX, footerY - 6, pageWidth - marginX, footerY - 6);
  doc.setFontSize(7);
  doc.setTextColor(140, 140, 140);
  if (opts.settings?.piedDePage) {
    doc.text(opts.settings.piedDePage, pageWidth / 2, footerY - 2, { align: "center" });
  }
  const penalites =
    opts.settings?.penalitesRetard ??
    "En cas de retard de paiement, une pénalité égale à 3 fois le taux d'intérêt légal sera exigée conformément à l'article L.441-6 du Code de commerce, ainsi qu'une indemnité forfaitaire de 40 euros pour frais de recouvrement (art. D.441-5).";
  doc.text(doc.splitTextToSize(`Règlement à réception. ${penalites}`, contentWidth), marginX, footerY + 3);

  return Buffer.from(doc.output("arraybuffer"));
}
