// Seul point de chargement du SDK `ovh` (envoi de SMS et lecture du solde).
// Isolé ici pour que les garde-fous de simulation (lib/outbound/mode.ts) et
// les tests puissent prouver qu'aucun client OVH n'est jamais créé en mode
// simulation.

export interface OvhClient {
  requestPromised(method: string, path: string, body?: unknown): Promise<unknown>;
}

export function createOvhClient(appKey: string, appSecret: string, consumerKey: string): OvhClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Ovh = require("ovh");
  return new Ovh({ appKey, appSecret, consumerKey }) as OvhClient;
}
