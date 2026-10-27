import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "./prisma";

type SubscriptionState = { stripeSubscriptionId: string | null; subscriptionStatus: string };

// Seuls ces statuts Stripe donnent accès à l'application. Liste blanche : les
// autres (past_due, unpaid, canceled, incomplete, incomplete_expired, paused…)
// bloquent, y compris un statut que Stripe ajouterait plus tard.
const ACCESS_STATUSES = new Set(["active", "trialing"]);

// Utilisé par app/dashboard/layout.tsx, les routes API et le moteur de relances :
// jamais passé par Stripe, ou abonnement ni actif ni en essai.
export function isSubscriptionBlocked(user: SubscriptionState) {
  return !user.stripeSubscriptionId || !ACCESS_STATUSES.has(user.subscriptionStatus);
}

// Un nouveau paiement Checkout n'est proposé que sans abonnement en cours :
// un abonnement actif, en essai ou impayé se gère dans le portail Stripe
// (sinon double abonnement, donc double prélèvement).
export function canStartCheckout(user: SubscriptionState) {
  return (
    !user.stripeSubscriptionId ||
    user.subscriptionStatus === "canceled" ||
    user.subscriptionStatus === "incomplete_expired"
  );
}

export async function getCurrentUser() {
  const { userId: clerkId } = await auth();
  if (!clerkId) return null;

  let user = await prisma.user.findUnique({ where: { clerkId } });

  if (!user) {
    const clerkUser = await currentUser();
    if (!clerkUser) return null;

    const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
    const companyName = clerkUser.firstName
      ? `${clerkUser.firstName} ${clerkUser.lastName ?? ""}`.trim()
      : email;

    // upsert évite la race condition si deux requêtes arrivent simultanément
    // pour un nouvel utilisateur (findUnique → null → create en double → P2002)
    user = await prisma.user.upsert({
      where: { clerkId },
      create: { clerkId, email, companyName },
      update: {},
    });
  }

  return user;
}
