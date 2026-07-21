import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import Stripe from "stripe";
import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { subscriptionToUserUpdate } from "@/lib/stripe-sync";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

// Filet de sécurité si un webhook Stripe est manqué (outage, mauvaise config
// après redeploy) : relit l'état réel de chaque abonnement actif auprès de
// Stripe et corrige la base si elle a dérivé.
async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${cronSecret}`) return true;
  }

  const { userId } = await auth();
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  return user?.email === ADMIN_EMAIL;
}

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: { stripeSubscriptionId: { not: null } },
    select: { id: true, stripeSubscriptionId: true, subscriptionStatus: true },
  });

  const checked = users.length;
  let updated = 0;
  const errors: string[] = [];

  for (const user of users) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId!);
      const next = subscriptionToUserUpdate(sub);
      if (next.subscriptionStatus !== user.subscriptionStatus) {
        await prisma.user.update({ where: { id: user.id }, data: next });
        console.info(
          `[stripe/resync] user ${user.id}: ${user.subscriptionStatus} -> ${next.subscriptionStatus}`
        );
        updated++;
      }
    } catch (err) {
      if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") {
        // Abonnement définitivement supprimé côté Stripe : on aligne la base.
        if (user.subscriptionStatus !== "canceled") {
          await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionStatus: "canceled", stripeCancelAtPeriodEnd: false },
          });
          updated++;
        }
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${user.id}: ${msg}`);
      console.error(`[stripe/resync] user ${user.id}:`, err);
    }
  }

  if (errors.length > 0) {
    Sentry.captureMessage(
      `[stripe/resync] ${errors.length} erreur(s) sur ${checked} abonnement(s) vérifiés`,
      "warning"
    );
  }

  return NextResponse.json({ checked, updated, errors });
}
