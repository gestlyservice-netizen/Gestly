import { transcribe, NoTranscriptGeneratedError, type TranscriptionModel } from "ai";
import { getWhatsappTranscriptionModel, isAiConfigured } from "@/lib/ai/config";
import { recordAiUsage } from "@/lib/ai/usage";

// Module isolé, comme lib/whatsapp/extraction.ts : aucune dépendance au
// webhook ou à l'orchestrateur, aucune interprétation métier (ça reste le
// rôle de l'extraction structurée existante), jamais de réécriture ou
// correction de ce qui a été dit. Seule dépendance Prisma indirecte :
// lib/ai/usage.ts, pour enregistrer chaque appel réellement effectué
// (étape 8) — aucune autre écriture en base ici.

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
  userId: string,
  // messageId : rattache les événements AiUsageEvent générés au
  // WhatsappMessage d'origine (étape 8bis, même esprit que extraction.ts) —
  // la déduplication réelle (jamais rappeler l'API pour un message déjà
  // transcrit) reste entièrement gérée en amont par voice-message.ts via
  // transcriptionStatus, inchangé ici.
  opts: { model?: TranscriptionModel | string; messageId?: string } = {}
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

      const transcriptionResult: TranscriptionResult = {
        text: (result.text ?? "").trim(),
        durationInSeconds: result.durationInSeconds ?? null,
        language: result.language ?? null,
      };
      // Un événement par appel réseau réel — cf. lib/ai/usage.ts. Jamais le
      // texte transcrit lui-même, seulement la durée audio.
      await recordAiUsage({
        userId,
        kind: "transcription",
        success: true,
        audioSeconds:
          transcriptionResult.durationInSeconds !== null
            ? Math.round(transcriptionResult.durationInSeconds)
            : null,
        messageId: opts.messageId ?? null,
      });
      return transcriptionResult;
    } catch (err) {
      // Un audio silencieux/incompréhensible fait lever cette erreur
      // spécifique par le SDK plutôt que de renvoyer un texte vide. Ce
      // n'est jamais transitoire — retenter la même transcription ne
      // produira rien de plus. On le traite comme un résultat vide plutôt
      // que comme un échec technique à retenter — l'appel au fournisseur a
      // bien eu lieu et abouti, donc compté en succès.
      if (err instanceof NoTranscriptGeneratedError) {
        await recordAiUsage({ userId, kind: "transcription", success: true, audioSeconds: null, messageId: opts.messageId ?? null });
        return { text: "", durationInSeconds: null, language: null };
      }
      await recordAiUsage({ userId, kind: "transcription", success: false, messageId: opts.messageId ?? null });
      lastError = err;
    }
  }

  throw new TranscriptionError(`Transcription échouée après ${MAX_ATTEMPTS} tentative(s)`, lastError);
}
