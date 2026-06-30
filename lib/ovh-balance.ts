export interface OvhSmsBalance {
  creditsLeft: number;
  lastChecked: Date;
}

export async function getOvhSmsBalance(): Promise<OvhSmsBalance> {
  const appKey      = process.env.OVH_APP_KEY;
  const appSecret   = process.env.OVH_APP_SECRET;
  const consumerKey = process.env.OVH_CONSUMER_KEY;
  const serviceName = process.env.OVH_SMS_SERVICE_NAME;

  if (!appKey || !appSecret || !consumerKey || !serviceName) {
    throw new Error("OVH SMS: missing environment variables");
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Ovh = require("ovh");
  const client = new Ovh({ appKey, appSecret, consumerKey });

  const data = await client.requestPromised("GET", `/sms/${serviceName}`) as { creditsLeft: number };

  return { creditsLeft: data.creditsLeft, lastChecked: new Date() };
}
