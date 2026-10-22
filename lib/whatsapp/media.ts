import { getGraphConfig } from "@/lib/whatsapp/graph-config";
import { isOutboundSimulated, recordSimulatedOutbound, simulatedId } from "@/lib/outbound/mode";

interface MetaMediaResponse {
  id?: string;
  error?: { message: string; code?: number };
}

// Upload d'un fichier vers l'API média Meta — renvoie un media_id à
// utiliser immédiatement dans un message document (lib/whatsapp/send.ts).
// Aucun stockage public nécessaire : le fichier ne transite que par Meta.
export async function uploadWhatsappMedia(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string
): Promise<{ mediaId: string }> {
  if (isOutboundSimulated()) {
    recordSimulatedOutbound("whatsapp.media_upload", null, `filename=${filename} size=${fileBuffer.length}`);
    return { mediaId: simulatedId("media") };
  }

  const { token, phoneNumberId, baseUrl } = getGraphConfig();

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", new Blob([new Uint8Array(fileBuffer)], { type: mimeType }), filename);

  const res = await fetch(`${baseUrl}/${phoneNumberId}/media`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });

  const data = (await res.json().catch(() => null)) as MetaMediaResponse | null;

  if (!res.ok || !data?.id) {
    const detail = data?.error ? `[${data.error.code ?? res.status}] ${data.error.message}` : `HTTP ${res.status}`;
    throw new Error(`Échec de l'upload média WhatsApp : ${detail}`);
  }

  return { mediaId: data.id };
}

// ── Téléchargement de média entrant (ex. message vocal) ──────────────────

export class MediaNotFoundError extends Error {}
export class MediaTooLargeError extends Error {}

interface MetaMediaMetadataResponse {
  url?: string;
  mime_type?: string;
  file_size?: number;
  error?: { message: string; code?: number };
}

export interface MediaMetadata {
  url: string; // URL temporaire signée par Meta, valable quelques minutes
  mimeType: string;
  fileSizeBytes: number | null;
}

// Récupère l'URL temporaire + les métadonnées d'un média déjà reçu (ex.
// message vocal), à partir de son identifiant Meta. Cette URL doit être
// appelée avec authentification (cf. downloadMediaBuffer) — jamais rendue
// publique, jamais réutilisée après quelques minutes.
export async function getMediaMetadata(mediaId: string): Promise<MediaMetadata> {
  // Mode simulation : aucun média réel ne peut être récupéré chez Meta. On
  // emprunte le chemin d'erreur existant "média introuvable", déjà géré par
  // les appelants (lib/whatsapp/voice-message.ts).
  if (isOutboundSimulated()) {
    recordSimulatedOutbound("whatsapp.media_download", null, `mediaId=${mediaId} (bloqué)`);
    throw new MediaNotFoundError("Média indisponible en mode simulation (aucun appel à Meta)");
  }

  const { token, baseUrl } = getGraphConfig();

  const res = await fetch(`${baseUrl}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const data = (await res.json().catch(() => null)) as MetaMediaMetadataResponse | null;

  if (!res.ok || !data?.url) {
    const detail = data?.error ? `[${data.error.code ?? res.status}] ${data.error.message}` : `HTTP ${res.status}`;
    throw new MediaNotFoundError(`Média introuvable : ${detail}`);
  }

  return {
    url: data.url,
    mimeType: data.mime_type ?? "application/octet-stream",
    fileSizeBytes: data.file_size ?? null,
  };
}

// 16 Mo : limite déjà appliquée par WhatsApp lui-même sur les fichiers
// audio, reprise ici comme garde-fou côté serveur avant tout envoi à un
// service de transcription.
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

// Télécharge le contenu d'un média depuis l'URL temporaire Meta. Toujours
// authentifié (même token que le reste de l'API Graph), jamais mis en
// cache, jamais écrit sur disque — le buffer ne vit qu'en mémoire le temps
// du traitement puis est simplement laissé au ramasse-miettes.
export async function downloadMediaBuffer(url: string, maxBytes: number = MAX_AUDIO_BYTES): Promise<Buffer> {
  if (isOutboundSimulated()) {
    recordSimulatedOutbound("whatsapp.media_download", null, "téléchargement bloqué");
    throw new Error("Téléchargement de média désactivé en mode simulation (aucun appel à Meta)");
  }

  const { token } = getGraphConfig();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Échec du téléchargement du média : HTTP ${res.status}`);
  }

  const announcedLength = res.headers.get("content-length");
  if (announcedLength && Number(announcedLength) > maxBytes) {
    throw new MediaTooLargeError(`Fichier trop volumineux (${announcedLength} octets, limite ${maxBytes})`);
  }

  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) {
    throw new MediaTooLargeError(`Fichier trop volumineux (${arrayBuffer.byteLength} octets, limite ${maxBytes})`);
  }

  return Buffer.from(arrayBuffer);
}
