import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");

  if (!sig) return NextResponse.json({ error: "Signature manquante" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Signature invalide" }, { status: 400 });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error(`[POST /api/stripe/webhook] Échec du traitement de "${event.type}":`, err);
    return NextResponse.json({ error: "Échec du traitement de l'événement" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  function toCustomerId(
    raw: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
  ): string | null {
    if (!raw) return null;
    return typeof raw === "string" ? raw : raw.id;
  }

  function toSubscriptionId(
    raw: string | Stripe.Subscription | null | undefined
  ): string | null {
    if (!raw) return null;
    return typeof raw === "string" ? raw : raw.id;
  }

  function periodEndDate(sub: Stripe.Subscription): Date | null {
    const ts = sub.items.data[0]?.current_period_end;
    return ts ? new Date(ts * 1000) : null;
  }

  function trialEndDate(sub: Stripe.Subscription): Date | null {
    const ts = sub.trial_end;
    return ts ? new Date(ts * 1000) : null;
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const cid = toCustomerId(session.customer);
      const subId = toSubscriptionId(session.subscription);
      if (cid && subId) {
        // Fetch full subscription to get billing dates
        const sub = await stripe.subscriptions.retrieve(subId);
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: {
            stripeSubscriptionId: subId,
            subscriptionStatus: sub.status,
            stripeCurrentPeriodEnd: periodEndDate(sub),
            stripeCancelAtPeriodEnd: sub.cancel_at_period_end,
            trialEndsAt: trialEndDate(sub) ?? undefined,
          },
        });
      }
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const cid = toCustomerId(sub.customer);
      if (cid) {
        const trialEnd = trialEndDate(sub);
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
            stripeCurrentPeriodEnd: periodEndDate(sub),
            stripeCancelAtPeriodEnd: sub.cancel_at_period_end,
            ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
          },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const cid = toCustomerId(sub.customer);
      if (cid) {
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: {
            subscriptionStatus: "canceled",
            stripeCancelAtPeriodEnd: false,
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const cid = toCustomerId(invoice.customer);
      if (cid) {
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: { subscriptionStatus: "past_due" },
        });
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const cid = toCustomerId(invoice.customer);
      if (cid) {
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: { subscriptionStatus: "active" },
        });
      }
      break;
    }
  }
}
