import type { SmsProvider } from "./types";
import { normalizePhoneE164 } from "@/lib/phone";
import { isOutboundSimulated, recordSimulatedOutbound } from "@/lib/outbound/mode";
import { createOvhClient } from "./ovh-client";

// OVH alphanumeric sender: 3–11 chars, alphanumeric only, no accents
function sanitizeSender(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 11);
  return s.length >= 3 ? s : "";
}

function isSenderRejected(err: unknown): boolean {
  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    return (
      e.error === 403 &&
      typeof e.message === "string" &&
      e.message.toLowerCase().includes("sender")
    );
  }
  return false;
}

export class OvhProvider implements SmsProvider {
  async sendSMS(to: string, message: string, sender?: string): Promise<boolean> {
    // Mode simulation (tout environnement hors production Vercel) : aucun
    // client OVH n'est créé, même si les clés sont présentes.
    if (isOutboundSimulated()) {
      recordSimulatedOutbound("sms", to, `length=${message.length}`);
      return true;
    }

    const appKey      = process.env.OVH_APP_KEY;
    const appSecret   = process.env.OVH_APP_SECRET;
    const consumerKey = process.env.OVH_CONSUMER_KEY;
    const serviceName = process.env.OVH_SMS_SERVICE_NAME;

    if (!appKey || !appSecret || !consumerKey || !serviceName) {
      console.error("OVH SMS: missing environment variables");
      return false;
    }

    const client = createOvhClient(appKey, appSecret, consumerKey);

    const raw = sender || process.env.OVH_SMS_SENDER || "";
    const effectiveSender = raw ? sanitizeSender(raw) : "";

    const payloadWithSender = {
      message,
      receivers: [normalizePhoneE164(to)],
      senderForResponse: false,
      sender: effectiveSender,
      noStopClause: false,
    };
    const payloadFallback = {
      message,
      receivers: [normalizePhoneE164(to)],
      senderForResponse: true,
      noStopClause: false,
    };

    // No valid sender → use short number directly
    if (!effectiveSender) {
      try {
        await client.requestPromised("POST", `/sms/${serviceName}/jobs`, payloadFallback);
        return true;
      } catch (err) {
        console.error("OVH SMS error:", err);
        return false;
      }
    }

    // Try with named sender, fallback to senderForResponse on OVH rejection
    try {
      await client.requestPromised("POST", `/sms/${serviceName}/jobs`, payloadWithSender);
      return true;
    } catch (err) {
      if (isSenderRejected(err)) {
        console.warn(`OVH SMS: sender "${effectiveSender}" not approved yet, retrying with senderForResponse`);
        try {
          await client.requestPromised("POST", `/sms/${serviceName}/jobs`, payloadFallback);
          return true;
        } catch (retryErr) {
          console.error("OVH SMS fallback error:", retryErr);
          return false;
        }
      }
      console.error("OVH SMS error:", err);
      return false;
    }
  }
}
