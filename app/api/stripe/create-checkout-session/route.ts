import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { canStartCheckout, getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { adoptOngoingSubscription } from "@/lib/stripe-webhook";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  // Abonnement en cours (actif, essai, impayé) : un second Checkout créerait un
  // deuxième abonnement facturé en parallèle. Il se gère depuis le portail.
  if (!canStartCheckout(user)) {
    return NextResponse.json(
      { error: "Vous avez déjà un abonnement. Gérez-le (moyen de paiement, résiliation) depuis le portail." },
      { status: 409 }
    );
  }

  try {
    // Dérive l'URL de base depuis les headers — fonctionne en dev et en prod
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("host") ?? "www.gestly.fr";
    const baseUrl = `${proto}://${host}`;

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.companyName,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await prisma.user.update({
        where: { id: user.id },
        data: { stripeCustomerId: customerId },
      });
    }

    if (await adoptOngoingSubscription(customerId)) {
      return NextResponse.json(
        { error: "Un abonnement est déjà en cours sur votre compte. Rechargez la page." },
        { status: 409 }
      );
    }

    // Essai gratuit uniquement au premier abonnement : un compte résilié qui se
    // réabonne paie dès la souscription.
    const firstSubscription = !user.stripeSubscriptionId;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{ price: process.env.STRIPE_PRICE_ID!.trim(), quantity: 1 }],
      mode: "subscription",
      ...(firstSubscription ? { subscription_data: { trial_period_days: 14 } } : {}),
      // {CHECKOUT_SESSION_ID} est remplacé par Stripe ; voir syncCheckoutSession.
      success_url: `${baseUrl}/abonnement?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/abonnement`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[POST /api/stripe/create-checkout-session]", err);
    return NextResponse.json({ error: "Impossible d'ouvrir le paiement. Réessayez." }, { status: 500 });
  }
}
