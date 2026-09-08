// L'IA n'est activée que si une clé/gateway est configurée côté serveur.
// Aucune clé n'est jamais exposée au client — cette fonction ne renvoie
// qu'un booléen.
export function isAiConfigured(): boolean {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

// Modèle utilisé pour l'extraction structurée du devis depuis WhatsApp
// (lib/whatsapp/extraction.ts). Centralisé ici : changer de modèle ou de
// fournisseur ne nécessite jamais de toucher à l'agent ou à l'extraction
// elle-même, seulement WHATSAPP_AI_MODEL ou cette valeur par défaut.
export const DEFAULT_WHATSAPP_EXTRACTION_MODEL = "openai/gpt-4o-mini";

export function getWhatsappExtractionModel(): string {
  return process.env.WHATSAPP_AI_MODEL?.trim() || DEFAULT_WHATSAPP_EXTRACTION_MODEL;
}

// Modèle utilisé pour transcrire les messages vocaux WhatsApp
// (lib/whatsapp/transcription.ts). Whisper reste le choix le plus établi et
// le plus largement documenté pour la transcription audio via OpenAI —
// changer pour un modèle plus récent (ex. gpt-4o-transcribe) se fait
// uniquement via WHATSAPP_TRANSCRIPTION_MODEL, sans toucher au workflow.
export const DEFAULT_WHATSAPP_TRANSCRIPTION_MODEL = "openai/whisper-1";

export function getWhatsappTranscriptionModel(): string {
  return process.env.WHATSAPP_TRANSCRIPTION_MODEL?.trim() || DEFAULT_WHATSAPP_TRANSCRIPTION_MODEL;
}

// Taux de TVA appliqué par défaut quand l'artisan ne le précise pas. Ce
// n'est pas un réglage par compte aujourd'hui (Settings n'a pas de champ TVA
// par défaut) — c'est le standard déjà utilisé partout ailleurs dans Gestly
// (Prisma: DevisLine.tvaRate @default(20)). Documenté ici pour rester la
// seule source de vérité de cette valeur.
export const DEFAULT_TVA_RATE = 20;
