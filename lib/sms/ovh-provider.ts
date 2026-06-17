import type { SmsProvider } from "./types";

function formatNumber(phone: string): string {
  let n = phone.replace(/\s+/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("0")) n = "33" + n.slice(1);
  return n;
}

export class OvhProvider implements SmsProvider {
  async sendSMS(to: string, message: string): Promise<boolean> {
    const appKey = process.env.OVH_APP_KEY;
    const appSecret = process.env.OVH_APP_SECRET;
    const consumerKey = process.env.OVH_CONSUMER_KEY;
    const serviceName = process.env.OVH_SMS_SERVICE_NAME;
    const sender = process.env.OVH_SMS_SENDER ?? "Gestly";

    if (!appKey || !appSecret || !consumerKey || !serviceName) {
      console.error("OVH SMS: missing environment variables");
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ovh = require("ovh");
    const client = new Ovh({ appKey, appSecret, consumerKey });

    try {
      await client.requestPromised("POST", `/sms/${serviceName}/jobs`, {
        message,
        receivers: [formatNumber(to)],
        sender,
        noStopClause: false,
      });
      return true;
    } catch (error) {
      console.error("OVH SMS error:", error);
      return false;
    }
  }
}
