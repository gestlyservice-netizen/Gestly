import type { WhatsappMessage } from "@prisma/client";
import type { TranscriptionModel } from "ai";
import { prisma } from "@/lib/prisma";
import { getMediaMetadata, downloadMediaBuffer, MediaTooLargeError } from "@/lib/whatsapp/media";
import { transcribeAudio } from "@/lib/whatsapp/transcription";
import { getWhatsappTranscriptionModel } from "@/lib/ai/config";
import { escalateToArtisan } from "@/lib/whatsapp/escalation";

export type VoiceResolution =
  | { kind: "transcribed"; text: string }
  | { kind: "failed"; reason: "media_not_found" | "unsupported_format" | "too_large" | "empty" };

const SUPPORTED_AUDIO_MIME_PREFIXES = [
  "audio/ogg",
  "audio/opus",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/amr",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
];

function isSupportedAudioMimeType(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return SUPPORTED_AUDIO_MIME_PREFIXES.some((p) => normalized.startsWith(p));
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Résout le texte d'un message vocal, en le transcrivant si nécessaire, et
// l'injecte ensuite comme entrée textuelle normale pour la suite du
// pipeline (conversation-turn.ts / extraction) — jamais de traitement
// parallèle spécifique à l'audio au-delà de cette résolution.
//
// Idempotence à deux niveaux :
// 1. Lecture : transcriptionStatus="done" déjà présent -> le texte déjà
//    transcrit est réutilisé tel quel, aucun nouvel appel de transcription.
// 2. Réclamation atomique : seul un message encore "pending" peut être
//    réclamé pour une tentative ("pending" -> "processing"). Un second
//    appel concurrent sur le même message échoue proprement (jamais un
//    second appel de transcription en parallèle) plutôt que de dupliquer
//    l'appel au service de transcription.
//
// Distinction retry / définitif :
// - Erreurs transitoires (téléchargement, appel de transcription) :
//   transcriptionStatus revient à "pending" et l'erreur est relevée, pour
//   que processWhatsappJob marque le job 'failed' et qu'un retry
//   automatique puisse réessayer proprement.
// - Erreurs définitives (média introuvable, format non supporté, fichier
//   trop volumineux, transcription vide) : transcriptionStatus passe à
//   "failed" de façon permanente, jamais retenté automatiquement ; un
//   résultat "failed" est renvoyé pour produire une réponse claire à
//   l'artisan sans jamais toucher au brouillon ou au devis.
export async function resolveVoiceMessageText(
  message: WhatsappMessage,
  userId: string,
  opts: { model?: TranscriptionModel | string } = {}
): Promise<VoiceResolution> {
  if (message.transcriptionStatus === "done" && message.transcription) {
    return { kind: "transcribed", text: message.transcription };
  }

  const claim = await prisma.whatsappMessage.updateMany({
    where: { id: message.id, transcriptionStatus: "pending" },
    data: { transcriptionStatus: "processing" },
  });

  if (claim.count === 0) {
    const fresh = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: message.id } });
    if (fresh.transcriptionStatus === "done" && fresh.transcription) {
      return { kind: "transcribed", text: fresh.transcription };
    }
    if (fresh.transcriptionStatus === "failed") {
      return { kind: "failed", reason: "empty" };
    }
    // "processing" : une autre tentative est en cours concurremment sur ce
    // même message — jamais un second appel de transcription en parallèle.
    throw new Error("Transcription déjà en cours pour ce message (concurrence)");
  }

  try {
    if (!message.mediaId) {
      await prisma.whatsappMessage.update({ where: { id: message.id }, data: { transcriptionStatus: "failed" } });
      await escalateToArtisan(
        userId,
        "transcription_echec",
        message.id,
        "Un message vocal reçu par WhatsApp n'a pas pu être traité (identifiant de média manquant) — la transcription a échoué définitivement."
      );
      return { kind: "failed", reason: "media_not_found" };
    }

    let metadata;
    try {
      metadata = await getMediaMetadata(message.mediaId);
    } catch (err) {
      // Média introuvable côté Meta (expiré, supprimé...) : ne s'améliorera
      // pas avec un retry — définitif, et opaque pour l'artisan (rien à
      // faire de son côté) : c'est le seul cas d'échec de transcription
      // considéré comme "définitif" au sens de l'escalade (étape 8) — les
      // autres (format non supporté, trop volumineux, vide) ont déjà une
      // réponse claire et actionnable par l'artisan lui-même.
      await prisma.whatsappMessage.update({ where: { id: message.id }, data: { transcriptionStatus: "failed" } });
      console.warn(`[whatsapp/voice] média introuvable user=${userId} messageId=${message.id}: ${errMessage(err)}`);
      await escalateToArtisan(
        userId,
        "transcription_echec",
        message.id,
        "Un message vocal reçu par WhatsApp n'a pas pu être récupéré (média introuvable) — la transcription a échoué définitivement."
      );
      return { kind: "failed", reason: "media_not_found" };
    }

    if (!isSupportedAudioMimeType(metadata.mimeType)) {
      await prisma.whatsappMessage.update({
        where: { id: message.id },
        data: { transcriptionStatus: "failed", mimeType: metadata.mimeType },
      });
      return { kind: "failed", reason: "unsupported_format" };
    }

    let audioBuffer: Buffer;
    try {
      audioBuffer = await downloadMediaBuffer(metadata.url);
    } catch (err) {
      if (err instanceof MediaTooLargeError) {
        await prisma.whatsappMessage.update({
          where: { id: message.id },
          data: { transcriptionStatus: "failed", mimeType: metadata.mimeType },
        });
        return { kind: "failed", reason: "too_large" };
      }
      throw err; // transitoire -> catch externe : revert "pending" + retry job
    }

    const model = opts.model ?? getWhatsappTranscriptionModel();
    const modelLabel = typeof model === "string" ? model : "modèle injecté (test)";
    const startedAt = Date.now();
    // audioBuffer ne vit qu'en mémoire ici — jamais écrit sur disque, jamais
    // stocké durablement ; il sort de portée (et devient éligible au
    // ramasse-miettes) dès la fin de cette fonction.
    const result = await transcribeAudio(audioBuffer, userId, { model: opts.model }); // erreurs transitoires levées telles quelles
    const elapsedMs = Date.now() - startedAt;

    // Instrumentation minimale pour mesurer l'usage réel (coût/latence)
    // sans jamais journaliser le contenu transcrit ni de token.
    console.info(
      `[whatsapp/voice] transcription user=${userId} modele=${modelLabel} duree_audio=${result.durationInSeconds ?? "?"}s temps_traitement=${elapsedMs}ms resultat=${result.text ? "succes" : "vide"}`
    );

    if (!result.text) {
      await prisma.whatsappMessage.update({
        where: { id: message.id },
        data: {
          transcriptionStatus: "failed",
          mimeType: metadata.mimeType,
          transcriptionModel: modelLabel,
          transcriptionMs: elapsedMs,
          durationSeconds: result.durationInSeconds !== null ? Math.round(result.durationInSeconds) : null,
        },
      });
      return { kind: "failed", reason: "empty" };
    }

    await prisma.whatsappMessage.update({
      where: { id: message.id },
      data: {
        transcription: result.text,
        transcriptionStatus: "done",
        mimeType: metadata.mimeType,
        durationSeconds: result.durationInSeconds !== null ? Math.round(result.durationInSeconds) : null,
        transcriptionModel: modelLabel,
        transcriptionMs: elapsedMs,
      },
    });

    return { kind: "transcribed", text: result.text };
  } catch (err) {
    // Échec transitoire : on revient à "pending" pour permettre un retry
    // propre (le job sera marqué 'failed' par l'appelant, cf. agent.ts).
    await prisma.whatsappMessage.updateMany({
      where: { id: message.id, transcriptionStatus: "processing" },
      data: { transcriptionStatus: "pending" },
    });
    throw err;
  }
}
