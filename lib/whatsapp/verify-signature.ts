import { createHmac, timingSafeEqual } from "crypto";

// Vérifie la signature Meta (HMAC-SHA256 du corps brut de la requête, avec
// l'App Secret comme clé — cf. https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validate-payloads).
//
// Échec fermé volontaire : si WHATSAPP_APP_SECRET n'est pas configuré, la
// fonction renvoie systématiquement false plutôt que de laisser passer une
// requête non vérifiable. Tant que ce secret n'est pas ajouté en production,
// aucun appel Meta réel ne sera jamais accepté par le webhook — c'est le
// comportement voulu, pas une régression.
export function isValidMetaSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader) return false;

  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice("sha256=".length)
    : signatureHeader;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, "hex");
    providedBuf = Buffer.from(provided, "hex");
  } catch {
    return false;
  }

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
