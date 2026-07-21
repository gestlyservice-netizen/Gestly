import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

// Route de diagnostic temporaire — audit go-to-market : vérifie que le Price
// Stripe LIVE référencé par STRIPE_PRICE_ID correspond bien aux 49 €/mois
// annoncés sur la landing. À retirer après vérification.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  const viaSecret = !!cronSecret && header === `Bearer ${cronSecret}`;

  if (!viaSecret) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    const user = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (user?.email !== ADMIN_EMAIL) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const priceId = process.env.STRIPE_PRICE_ID;
    if (!priceId) return NextResponse.json({ error: "STRIPE_PRICE_ID manquant" }, { status: 500 });

    const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
    const product = price.product as unknown as { name?: string };

    return NextResponse.json({
      id: price.id,
      active: price.active,
      livemode: price.livemode,
      currency: price.currency,
      unit_amount: price.unit_amount,
      amount_eur: price.unit_amount ? price.unit_amount / 100 : null,
      interval: price.recurring?.interval,
      product_name: product?.name,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
