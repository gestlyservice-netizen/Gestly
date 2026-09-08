import { getGraphConfig } from "@/lib/whatsapp/graph-config";

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
