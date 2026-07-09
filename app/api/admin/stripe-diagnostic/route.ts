import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";

export async function GET(req: NextRequest) {
  const secret = process.env.AUDIT_DIAGNOSTIC_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  const mode = key.startsWith("sk_live") ? "live" : key.startsWith("sk_test") ? "test" : "unknown";

  const priceId = process.env.STRIPE_PRICE_ID?.trim() ?? null;
  let price: unknown = null;
  let priceError: string | null = null;
  try {
    if (priceId) {
      const p = await stripe.prices.retrieve(priceId, { expand: ["product"] });
      price = {
        id: p.id,
        active: p.active,
        currency: p.currency,
        unit_amount: p.unit_amount,
        recurring: p.recurring,
        product: typeof p.product === "object" && p.product && "name" in p.product
          ? { id: p.product.id, name: (p.product as { name?: string }).name, active: (p.product as { active?: boolean }).active }
          : p.product,
      };
    }
  } catch (e) {
    priceError = e instanceof Error ? e.message : String(e);
  }

  let webhookEndpoints: unknown = null;
  let webhookError: string | null = null;
  try {
    const list = await stripe.webhookEndpoints.list({ limit: 20 });
    webhookEndpoints = list.data.map((w) => ({
      id: w.id,
      url: w.url,
      status: w.status,
      enabled_events: w.enabled_events,
    }));
  } catch (e) {
    webhookError = e instanceof Error ? e.message : String(e);
  }

  let taxSettings: unknown = null;
  let taxRegistrations: unknown = null;
  let taxError: string | null = null;
  try {
    const s = await stripe.tax.settings.retrieve();
    taxSettings = { status: s.status, head_office: s.head_office, defaults: s.defaults };
    const regs = await stripe.tax.registrations.list({ limit: 10 });
    taxRegistrations = regs.data.map((r) => ({ country: r.country, status: r.status }));
  } catch (e) {
    taxError = e instanceof Error ? e.message : String(e);
  }

  let portalConfig: unknown = null;
  let portalError: string | null = null;
  try {
    const configs = await stripe.billingPortal.configurations.list({ limit: 5 });
    portalConfig = configs.data.map((c) => ({
      id: c.id,
      is_default: c.is_default,
      active: c.active,
      invoice_history: c.features.invoice_history.enabled,
      payment_method_update: c.features.payment_method_update.enabled,
      subscription_cancel: c.features.subscription_cancel.enabled,
      subscription_cancel_mode: c.features.subscription_cancel.mode,
    }));
  } catch (e) {
    portalError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    mode,
    keyLength: key.length,
    priceId,
    price,
    priceError,
    webhookEndpoints,
    webhookError,
    taxSettings,
    taxRegistrations,
    taxError,
    portalConfig,
    portalError,
    webhookSecretConfigured: !!process.env.STRIPE_WEBHOOK_SECRET,
    publishableKeyConfigured: !!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
  });
}
