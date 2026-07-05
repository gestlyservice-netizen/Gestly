import { redirect } from "next/navigation";
import { CheckCircle, Clock, AlertTriangle, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { CheckoutButton } from "./checkout-button";

export default async function AbonnementPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const hasSubscription = !!user.stripeSubscriptionId;
  const status = user.subscriptionStatus;
  const isActiveOrTrialing = status === "active" || status === "trialing";
  const isSuspended = status === "canceled" || status === "past_due";

  let nextBillingDate: string | null = null;
  if (hasSubscription && isActiveOrTrialing && user.stripeSubscriptionId) {
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
            <h1 className="text-2xl font-bold text-white">Gestly Pro</h1>
            <p className="text-blue-100 mt-1 text-sm">49&nbsp;€ / mois · sans engagement</p>
          </div>

          <div className="px-8 py-8 text-center space-y-6">

            {/* Nouvel inscrit — pas encore de Stripe */}
            {!hasSubscription && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-blue-50 p-4">
                    <Sparkles className="h-10 w-10 text-blue-500" />
                  </div>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">
                    14 jours gratuits, sans engagement
                  </p>
                  <p className="text-slate-500 text-sm mt-2">
                    Entrez votre carte pour commencer. Aucun prélèvement pendant 14 jours —
                    annulable à tout moment avant la fin de l&apos;essai.
                  </p>
                </div>

                {/* Points forts */}
                <ul className="text-sm text-slate-600 space-y-2 text-left">
                  {[
                    "Devis et factures illimités",
                    "Envoi SMS & WhatsApp intégré",
                    "Suivi des paiements en temps réel",
                    "Support prioritaire",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <CheckoutButton label="Démarrer mon essai gratuit de 14 jours" />
                <p className="text-xs text-slate-400">
                  Aucun prélèvement avant le 14ème jour.
                </p>
              </>
            )}

            {/* Abonnement actif ou en cours d'essai Stripe */}
            {hasSubscription && isActiveOrTrialing && (
              <>
                <div className="flex justify-center">
                  <div className="rounded-full bg-green-50 p-4">
                    <CheckCircle className="h-10 w-10 text-green-500" />
                  </div>
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">
                    {status === "trialing" ? "Essai gratuit en cours" : "Abonnement actif"}
                  </p>
                  {nextBillingDate && (
                    <p className="text-slate-500 text-sm mt-1">
                      {status === "trialing"
                        ? `Premier prélèvement le ${nextBillingDate}`
                        : `Prochain prélèvement le ${nextBillingDate}`}
                    </p>
                  )}
                </div>
                <a
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Accéder au dashboard
                </a>
              </>
            )}

            {/* Suspendu */}
            {hasSubscription && isSuspended && (
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
                    Toutes vos données sont conservées.
                  </p>
                </div>
                <CheckoutButton label="Réactiver mon abonnement — 49 €/mois" />
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
