/**
 * Utilitaires de génération PDF côté client.
 * Utilise html2canvas + jsPDF pour capturer le rendu HTML d'une page d'impression.
 */

/**
 * Capture un élément DOM et génère un PDF téléchargeable.
 */
export async function downloadElementAsPDF(
  element: HTMLElement,
  filename: string
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/jpeg", 0.95);
  const pdf = new jsPDF({
    unit: "px",
    format: [canvas.width / 2, canvas.height / 2],
  });
  pdf.addImage(imgData, "JPEG", 0, 0, canvas.width / 2, canvas.height / 2);
  pdf.save(filename);
}

/**
 * Ouvre la page d'impression d'une facture et déclenche le téléchargement PDF.
 */
export function generateFacturePDF(factureId: string): void {
  window.open(`/print/factures/${factureId}?download=1`, "_blank");
}

/**
 * Ouvre la page d'impression d'un devis et déclenche le téléchargement PDF.
 */
export function generateDevisPDF(devisId: string): void {
  window.open(`/print/devis/${devisId}?download=1`, "_blank");
}
