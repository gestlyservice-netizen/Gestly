export function getPublicUrl(): string {
  return process.env.APP_URL ?? "https://gestly-iota.vercel.app";
}

export function devisPublicLink(devisId: string): string {
  return `${getPublicUrl()}/d/${devisId}`;
}
