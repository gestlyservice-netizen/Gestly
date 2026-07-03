import { redirect } from "next/navigation";
import { CheckCircle, Clock, AlertTriangle } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { CheckoutButton } from "./checkout-button";

export default async function AbonnementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const now = new Date();
  const status = user.subscriptionStatus;
  const isTrialing = status === "trialing" || status === "trial";
  const isActive = status === "active";
  const trialDaysLeft = user.trialEndsAt
    ? Math.max(0, Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / 86_400_000))
    : 0;

  let nextBillingDate: string | null = null;
  if (isActive && user.stripeSubscriptionId) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId);
      const periodEnd = sub.items.data[0]?.current_period_end;
      if (periodEnd) {
        nextBillingDate = new Date(periodEnd * 1000).toLocaleDateString("fr-FR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });
      }
    } catch {
      // Subscription non accessible — on ignore
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* En-tête */}
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 px-8 py-10 text-center">
            <h1 className="text-2xl font-bold text-white">Mon abonnement</h1>
            <p className="text-blue-100 mt-1 text-sm">Gestly Pro — 49&nbsp;€/mois</p>
          </div>

          <div className="px-8 py-8 text-center space-y-6">

            {/* Trial en cours */}
            {isTrialing && trialDaysLeft > 0 && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-amber-50 p-4">
                    <Clock className="h-10 w-10 text-amber-500" />
                  </div>
                </div>
                <div>
                  <p className="text-2xl font-bold text-slate-900">
                    {trialDaysLeft} jour{trialDaysLeft > 1 ? "s" : ""} restant{trialDaysLeft > 1 ? "s" : ""}
                  </p>
                  <p className="text-slate-500 text-sm mt-1">
                    Votre essai gratuit se termine le{" "}
                    {user.trialEndsAt?.toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "long",
                    })}
                  </p>
                </div>
                <CheckoutButton label="Activer mon abonnement — 49 €/mois" />
                <p className="text-xs text-slate-400">
                  Sans engagement. Résiliable à tout moment.
                </p>
              </>
            )}

            {/* Actif */}
            {isActive && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-green-50 p-4">
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  </div>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">Abonnement actif</p>
                  {nextBillingDate && (
                    <p className="text-slate-500 text-sm mt-1">
                      Prochain prélèvement le {nextBillingDate}
                    </p>
                  )}
                </div>
                <a
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Retour au dashboard
                </a>
              </>
            )}

            {/* Expiré / suspendu / trial épuisé */}
            {!isActive && (!isTrialing || trialDaysLeft === 0) && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-red-50 p-4">
                    <AlertTriangle className="h-10 w-10 text-red-500" />
                  </div>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">Abonnement suspendu</p>
                  <p className="text-slate-500 text-sm mt-1">
                    Votre accès à Gestly est temporairement limité.
                  </p>
                </div>
                <CheckoutButton label="Réactiver mon abonnement — 49 €/mois" />
                <p className="text-xs text-slate-400">
                  Toutes vos données sont conservées.
                </p>
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
