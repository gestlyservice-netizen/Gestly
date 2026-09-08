// Configuration Graph API Meta centralisée — seul endroit qui lit les
// variables d'environnement WhatsApp. Le token n'est jamais journalisé, ni
// ici ni par les appelants (aucun console.log/error ne doit jamais inclure
// `token`).
//
// L'URL de base est configurable (WHATSAPP_GRAPH_API_BASE_URL) : permet de
// changer de version d'API sans redéploiement, et de router vers un
// transport simulé en tests sans jamais contacter Meta.
export interface GraphConfig {
  token: string;
  phoneNumberId: string;
  baseUrl: string;
}

export function getGraphConfig(): GraphConfig {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error("Variables d'environnement WhatsApp manquantes (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)");
  }

  return {
    token,
    phoneNumberId,
    baseUrl: process.env.WHATSAPP_GRAPH_API_BASE_URL ?? "https://graph.facebook.com/v18.0",
  };
}
