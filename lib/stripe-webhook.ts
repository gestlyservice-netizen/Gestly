import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { toCustomerId, subscriptionToUserUpdate } from "@/lib/stripe-sync";
import { createNotification } from "@/lib/notifications";

function toSubscriptionId(raw: string | Stripe.Subscription | null | undefined): string | null {
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id;
}

// Depuis l'API Stripe 2025-03 (basil), l'abonnement d'une facture n'est plus
// dans invoice.subscription mais dans invoice.parent.subscription_details.
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  return toSubscriptionId(invoice.parent?.subscription_details?.subscription);
}

// Recopie l'état RÉEL de l'abonnement (relu chez Stripe, pas l'instantané de
// l'événement) : les webhooks peuvent arriver dans le désordre ou en double,
// et une facture payée pendant l'essai (0 €) ne doit pas passer le compte en
// "active". Seul l'abonnement courant de l'utilisateur est pris en compte :
// un événement tardif d'un ancien abonnement résilié n'écrase pas le nouveau.
export async function syncSubscription(cid: string, subId: string, opts: { adopt?: boolean } = {}) {
  const sub = await stripe.subscriptions.retrieve(subId);
  const result = await prisma.user.updateMany({
    where: opts.adopt
      ? { stripeCustomerId: cid }
      : { stripeCustomerId: cid, OR: [{ stripeSubscriptionId: null }, { stripeSubscriptionId: subId }] },
    data: subscriptionToUserUpdate(sub),
  });
  return { sub, updated: result.count };
}

// Retour de Checkout (success_url) : le webhook peut arriver après le
// navigateur. Sans cette synchronisation, l'utilisateur qui vient de payer
// serait renvoyé vers /abonnement et pourrait souscrire une seconde fois.
// La session n'est prise en compte que si elle appartient à ce client Stripe.
export async function syncCheckoutSession(customerId: string | null, sessionId: string) {
  if (!customerId || !sessionId.startsWith("cs_")) return false;
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const subId = toSubscriptionId(session.subscription);
  if (toCustomerId(session.customer) !== customerId || session.status !== "complete" || !subId) return false;
  await syncSubscription(customerId, subId, { adopt: true });
  return true;
}

// Filet contre le double abonnement : un abonnement encore en cours chez Stripe
// (webhook en retard, double clic) est adopté au lieu d'en créer un second.
export async function adoptOngoingSubscription(customerId: string) {
  const { data } = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  const ongoing = data.find((s) => s.status === "active" || s.status === "trialing" || s.status === "past_due" || s.status === "unpaid");
  if (!ongoing) return false;
  await syncSubscription(customerId, ongoing.id, { adopt: true });
  return true;
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const cid = toCustomerId(session.customer);
      const subId = toSubscriptionId(session.subscription);
      // Nouvel abonnement souscrit : il devient l'abonnement courant.
      if (cid && subId) await syncSubscription(cid, subId, { adopt: true });
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const cid = toCustomerId(sub.customer);
      if (cid) await syncSubscription(cid, sub.id);
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const cid = toCustomerId(invoice.customer);
      const subId = invoiceSubscriptionId(invoice);
      if (cid && subId) {
        const { updated } = await syncSubscription(cid, subId);
        const user = updated > 0
          ? await prisma.user.findFirst({ where: { stripeCustomerId: cid } })
          : null;
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
      const subId = invoiceSubscriptionId(invoice);
      if (cid && subId) await syncSubscription(cid, subId);
      break;
    }
  }
}
