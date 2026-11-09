// Échappement HTML des valeurs saisies par l'artisan ou son client (nom,
// description de ligne, notes, raison sociale...) avant insertion dans le
// corps d'un email. Sans lui, « <a href=…> » ou « <img src=…> » dans une
// donnée serait interprété par la messagerie du destinataire (injection
// HTML : faux lien, contenu masqué, image de pistage).
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => HTML_ENTITIES[c]);
}
