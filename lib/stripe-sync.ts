import type Stripe from "stripe";

export function toCustomerId(
  raw: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
): string | null {
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id;
}

export function periodEndDate(sub: Stripe.Subscription): Date | null {
  const ts = sub.items.data[0]?.current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

export function trialEndDate(sub: Stripe.Subscription): Date | null {
  const ts = sub.trial_end;
  return ts ? new Date(ts * 1000) : null;
}

// État Prisma dérivé de l'état réel d'un abonnement Stripe — utilisé à la fois
// par le webhook (temps réel) et la resynchronisation périodique (filet de secours).
export function subscriptionToUserUpdate(sub: Stripe.Subscription) {
  const trialEnd = trialEndDate(sub);
  return {
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    stripeCurrentPeriodEnd: periodEndDate(sub),
    stripeCancelAtPeriodEnd: sub.cancel_at_period_end,
    ...(trialEnd ? { trialEndsAt: trialEnd } : {}),
  };
}
