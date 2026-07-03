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

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const cid = toCustomerId(session.customer);
      if (cid) {
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: {
            stripeSubscriptionId: toSubscriptionId(session.subscription),
            subscriptionStatus: "active",
          },
        });
      }
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const cid = toCustomerId(sub.customer);
      if (cid) {
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: sub.status,
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
          data: { subscriptionStatus: "canceled" },
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
  }

  return NextResponse.json({ received: true });
}
