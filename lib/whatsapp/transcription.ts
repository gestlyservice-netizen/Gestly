import { transcribe, NoTranscriptGeneratedError, type TranscriptionModel } from "ai";
import { getWhatsappTranscriptionModel, isAiConfigured } from "@/lib/ai/config";

// Module isolé, comme lib/whatsapp/extraction.ts : aucune dépendance à
// Prisma, au webhook ou à l'orchestrateur. Rôle strictement limité à
// l'appel du service de transcription — jamais d'interprétation métier
// (ça reste le rôle de l'extraction structurée existante), jamais de
// réécriture ou correction de ce qui a été dit.

export class TranscriptionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TranscriptionError";
  }
}

export interface TranscriptionResult {
  text: string;
  durationInSeconds: number | null;
  language: string | null;
}

// Vocabulaire de biais (pas une instruction de réécriture) : aide le
// modèle à mieux reconnaître les termes du métier et les nombres/montants,
// sans jamais lui demander de corriger, interpréter ou compléter quoi que
// ce soit. Whisper utilise ce "prompt" uniquement pour orienter le style et
// le vocabulaire attendu, pas pour changer le contenu transcrit.
const VOCABULARY_HINT =
  "Devis, facture, artisan, peinture, plomberie, électricité, menuiserie, carrelage, maçonnerie, TVA, HT, TTC, euros, mètres carrés.";

const MAX_ATTEMPTS = 2;

export async function transcribeAudio(
  audio: Buffer | Uint8Array,
  opts: { model?: TranscriptionModel | string } = {}
): Promise<TranscriptionResult> {
  if (opts.model === undefined && !isAiConfigured()) {
    // Échoue vite plutôt que de tenter un appel réseau voué à l'échec —
    // même logique que lib/whatsapp/extraction.ts.
    throw new TranscriptionError("Transcription IA non configurée (aucune clé IA disponible)");
  }

  const model = opts.model ?? getWhatsappTranscriptionModel();

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await transcribe({
        model,
        audio: audio instanceof Buffer ? new Uint8Array(audio) : audio,
        providerOptions: {
          openai: {
            language: "fr",
            prompt: VOCABULARY_HINT,
          },
        },
      });

      return {
        text: (result.text ?? "").trim(),
        durationInSeconds: result.durationInSeconds ?? null,
        language: result.language ?? null,
      };
    } catch (err) {
      // Un audio silencieux/incompréhensible fait lever cette erreur
      // spécifique par le SDK plutôt que de renvoyer un texte vide. Ce
      // n'est jamais transitoire — retenter la même transcription ne
      // produira rien de plus. On le traite comme un résultat vide plutôt
      // que comme un échec technique à retenter.
      if (err instanceof NoTranscriptGeneratedError) {
        return { text: "", durationInSeconds: null, language: null };
      }
      lastError = err;
    }
  }

  throw new TranscriptionError(`Transcription échouée après ${MAX_ATTEMPTS} tentative(s)`, lastError);
}
