import { redirect } from "next/navigation";
import { CheckCircle, AlertTriangle, Sparkles } from "lucide-react";
import { canStartCheckout, getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { syncCheckoutSession } from "@/lib/stripe-webhook";
import { PortalButton } from "@/app/dashboard/parametres/abonnement/portal-button";
import { CheckoutButton } from "./checkout-button";

export default async function AbonnementPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  let user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  // Retour de Stripe Checkout : synchronise sans attendre le webhook.
  if (searchParams.session_id) {
    let synced = false;
    try {
      synced = await syncCheckoutSession(user.stripeCustomerId, searchParams.session_id);
    } catch (err) {
      console.error("[/abonnement] synchronisation Checkout", err);
    }
    if (synced) {
      const fresh = await getCurrentUser();
      if (fresh && !isSubscriptionBlocked(fresh)) redirect("/dashboard?payment=success");
      if (fresh) user = fresh;
    }
  }

  const hasSubscription = !!user.stripeSubscriptionId;
  const status = user.subscriptionStatus;
  const isActiveOrTrialing = !isSubscriptionBlocked(user);
  // Tout abonnement existant qui ne donne pas accès (impayé, résilié, incomplet…).
  const isSuspended = hasSubscription && !isActiveOrTrialing;
  // Impayé : on régularise le moyen de paiement dans le portail, sans second abonnement.
  const canResubscribe = canStartCheckout(user);

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
                    "Envoi des devis par WhatsApp",
                    "Suivi des paiements en temps réel",
                    "Support prioritaire",
                  ].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>

                <CheckoutButton label="Démarrer mon essai gratuit de 14 jours" requireConsent />
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
                {canResubscribe ? (
                  <CheckoutButton label="Réactiver mon abonnement — 49 €/mois" />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm text-slate-600">
                      Le dernier paiement n&apos;a pas abouti. Mettez à jour votre moyen de paiement :
                    </p>
                    <PortalButton />
                  </div>
                )}
              </>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
