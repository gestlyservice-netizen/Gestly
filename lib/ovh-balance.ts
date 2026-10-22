import { isOutboundSimulated, recordSimulatedOutbound } from "@/lib/outbound/mode";
import { createOvhClient } from "@/lib/sms/ovh-client";

export interface OvhSmsBalance {
  creditsLeft: number;
  lastChecked: Date;
}

// Solde renvoyé en mode simulation : volontairement au-dessus de tous les
// seuils d'alerte (app/api/admin/ovh-balance/check) et du minimum requis par
// les relances SMS, pour que les parcours se déroulent normalement.
export const SIMULATED_SMS_CREDITS = 1000;

export async function getOvhSmsBalance(): Promise<OvhSmsBalance> {
  if (isOutboundSimulated()) {
    recordSimulatedOutbound("sms.balance", null, `creditsLeft=${SIMULATED_SMS_CREDITS}`);
    return { creditsLeft: SIMULATED_SMS_CREDITS, lastChecked: new Date() };
  }

  const appKey      = process.env.OVH_APP_KEY;
  const appSecret   = process.env.OVH_APP_SECRET;
  const consumerKey = process.env.OVH_CONSUMER_KEY;
  const serviceName = process.env.OVH_SMS_SERVICE_NAME;

  if (!appKey || !appSecret || !consumerKey || !serviceName) {
    throw new Error("OVH SMS: missing environment variables");
  }

  const client = createOvhClient(appKey, appSecret, consumerKey);

  const data = await client.requestPromised("GET", `/sms/${serviceName}`) as { creditsLeft: number };

  return { creditsLeft: data.creditsLeft, lastChecked: new Date() };
}
