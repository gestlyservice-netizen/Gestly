// L'IA n'est activée que si une clé/gateway est configurée côté serveur.
// Aucune clé n'est jamais exposée au client — cette fonction ne renvoie
// qu'un booléen.
export function isAiConfigured(): boolean {
  return !!(process.env.AI_GATEWAY_API_KEY || process.env.OPENAI_API_KEY);
}
