import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    line_items: [{ price: process.env.STRIPE_PRICE_ID!.trim(), quantity: 1 }],
    mode: "subscription",
    subscription_data: { trial_period_days: 14 },
    success_url: `${baseUrl}/dashboard?payment=success`,
    cancel_url: `${baseUrl}/abonnement`,
  });

  return NextResponse.json({ url: session.url });
}
