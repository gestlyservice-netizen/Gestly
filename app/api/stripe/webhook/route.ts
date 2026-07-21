import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { toCustomerId, subscriptionToUserUpdate } from "@/lib/stripe-sync";
import { createNotification } from "@/lib/notifications";

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
      const subId = toSubscriptionId(session.subscription);
      if (cid && subId) {
        // Fetch full subscription to get billing dates
        const sub = await stripe.subscriptions.retrieve(subId);
        await prisma.user.updateMany({
          where: { stripeCustomerId: cid },
          data: subscriptionToUserUpdate(sub),
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
          data: subscriptionToUserUpdate(sub),
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
        const user = await prisma.user.findFirst({ where: { stripeCustomerId: cid } });
        if (user) {
          await createNotification(
            user.id,
            "paiement_echoue",
            "Le paiement de votre abonnement Gestly a échoué. Mettez à jour votre moyen de paiement pour éviter une suspension.",
            "/dashboard/parametres/abonnement"
          );
        }
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
