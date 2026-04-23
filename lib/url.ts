const CANONICAL_URL = "https://gestly-iota.vercel.app";

function resolvePublicUrl(): string {
  const raw = process.env.APP_URL;
  if (!raw) return CANONICAL_URL;
  const url = raw.replace(/\/+$/, "");
  // Reject localhost and any Vercel preview URL that isn't the production one
  if (url.includes("localhost") || (url.includes(".vercel.app") && url !== CANONICAL_URL)) {
    return CANONICAL_URL;
  }
  return url;
}

const PUBLIC_URL = resolvePublicUrl();

export function getPublicUrl(): string {
  return PUBLIC_URL;
}

export function devisPublicLink(devisId: string): string {
  return `${PUBLIC_URL}/d/${devisId}`;
}
