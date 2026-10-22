import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, TranscriptionModel } from "ai";
import { isOutboundSimulated } from "@/lib/outbound/mode";

// L'IA n'est activée que si une clé/gateway est configurée côté serveur.
// Aucune clé n'est jamais exposée au client — cette fonction ne renvoie
// qu'un booléen.
//
// Mode simulation (lib/outbound/mode.ts) : l'IA est toujours considérée comme
// NON configurée, même si une clé est présente. Tous les appelants
// (extraction, transcription, amélioration de message) empruntent alors leur
// chemin "IA non configurée" existant, sans aucun appel facturé. Les tests
// injectent leurs propres modèles simulés (ai/test) et ne passent pas par ici.
export function isAiConfigured(): boolean {
  if (isOutboundSimulated()) return false;
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}

// Second verrou, au point de résolution du modèle réel : même si un appelant
// oubliait de vérifier isAiConfigured(), aucun modèle réel n'est jamais
// construit en mode simulation.
function assertAiCallsAllowed(): void {
  if (isOutboundSimulated()) {
    throw new Error("Appel IA réel bloqué : mode simulation des envois actif (lib/outbound/mode.ts)");
  }
}

// Modèle utilisé pour l'extraction structurée du devis depuis WhatsApp
// (lib/whatsapp/extraction.ts). Centralisé ici : changer de modèle ou de
// fournisseur ne nécessite jamais de toucher à l'agent ou à l'extraction
// elle-même, seulement WHATSAPP_AI_MODEL ou cette valeur par défaut.
//
// Format "openai/gpt-4o-mini" (identifiant Vercel AI Gateway) uniquement
// pertinent si AI_GATEWAY_API_KEY est configuré. Découvert en Phase 2 de la
// validation pré-production (2026-09) : une chaîne "provider/model" passée
// telle quelle à generateObject()/transcribe() route TOUJOURS par l'AI
// Gateway, qui exige AI_GATEWAY_API_KEY (ou un jeton OIDC Vercel en
// déploiement) — elle ne retombe jamais sur OPENAI_API_KEY seul, même si
// isAiConfigured() le considère comme suffisant. D'où la construction
// explicite d'une instance de modèle via @ai-sdk/openai quand seul
// OPENAI_API_KEY est disponible (cf. getWhatsappExtractionModel ci-dessous).
export const DEFAULT_WHATSAPP_EXTRACTION_MODEL = "openai/gpt-4o-mini";

// Retire le préfixe "openai/" éventuel (format Gateway) pour obtenir
// l'identifiant de modèle attendu par le SDK OpenAI direct.
function stripOpenAiPrefix(modelId: string): string {
  return modelId.replace(/^openai\//, "");
}

function directOpenAiClient() {
  return createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// AI_GATEWAY_API_KEY configuré : on garde le format Gateway existant
// ("provider/model", résolu par la chaîne elle-même). Sinon, si seul
// OPENAI_API_KEY est disponible, on construit une vraie instance de modèle
// via le SDK OpenAI direct — jamais une chaîne, qui échouerait
// silencieusement sur l'AI Gateway non configuré.
export function getWhatsappExtractionModel(): LanguageModel | string {
  assertAiCallsAllowed();
  const override = process.env.WHATSAPP_AI_MODEL?.trim();
  if (process.env.AI_GATEWAY_API_KEY) {
    return override || DEFAULT_WHATSAPP_EXTRACTION_MODEL;
  }
  return directOpenAiClient()(stripOpenAiPrefix(override || DEFAULT_WHATSAPP_EXTRACTION_MODEL));
}

// Modèle utilisé pour transcrire les messages vocaux WhatsApp
// (lib/whatsapp/transcription.ts). Whisper reste le choix le plus établi et
// le plus largement documenté pour la transcription audio via OpenAI —
// changer pour un modèle plus récent (ex. gpt-4o-transcribe) se fait
// uniquement via WHATSAPP_TRANSCRIPTION_MODEL, sans toucher au workflow.
export const DEFAULT_WHATSAPP_TRANSCRIPTION_MODEL = "openai/whisper-1";

export function getWhatsappTranscriptionModel(): TranscriptionModel | string {
  assertAiCallsAllowed();
  const override = process.env.WHATSAPP_TRANSCRIPTION_MODEL?.trim();
  if (process.env.AI_GATEWAY_API_KEY) {
    return override || DEFAULT_WHATSAPP_TRANSCRIPTION_MODEL;
  }
  return directOpenAiClient().transcription(stripOpenAiPrefix(override || DEFAULT_WHATSAPP_TRANSCRIPTION_MODEL));
}

// Description lisible d'un modèle pour les logs/traçabilité
// (transcriptionModel, extractionModel...) — jamais le nom d'un fournisseur
// à partir d'un simple typeof, qui confondait à tort toute instance directe
// @ai-sdk/openai (usage réel sans Gateway) avec un mock de test. Une
// instance de modèle réelle porte toujours modelId ; seul un mock de test
// injecté sans cette propriété retombe sur le libellé générique.
export function describeModel(model: unknown): string {
  if (typeof model === "string") return model;
  if (model && typeof model === "object" && "modelId" in model && typeof (model as { modelId: unknown }).modelId === "string") {
    return (model as { modelId: string }).modelId;
  }
  return model ? "modèle injecté (test)" : "(non résolu)";
}

// Taux de TVA appliqué par défaut quand l'artisan ne le précise pas. Ce
// n'est pas un réglage par compte aujourd'hui (Settings n'a pas de champ TVA
// par défaut) — c'est le standard déjà utilisé partout ailleurs dans Gestly
// (Prisma: DevisLine.tvaRate @default(20)). Documenté ici pour rester la
// seule source de vérité de cette valeur.
export const DEFAULT_TVA_RATE = 20;
