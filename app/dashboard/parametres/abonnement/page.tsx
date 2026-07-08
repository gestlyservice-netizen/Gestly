import { redirect } from "next/navigation";
import Link from "next/link";
import {
  CreditCard, CheckCircle, AlertTriangle, XCircle,
  ArrowLeft, ExternalLink, Clock,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { PortalButton } from "./portal-button";

/* ── Badge statut ───────────────────────────────────────────── */
function StatusBadge({ status, cancelAtPeriodEnd }: { status: string; cancelAtPeriodEnd: boolean }) {
  if (cancelAtPeriodEnd) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 ring-1 ring-amber-200">
        <Clock className="h-3 w-3" />
        Résiliation programmée
      </span>
    );
  }
  const configs: Record<string, { label: string; color: string; Icon: typeof CheckCircle }> = {
    trialing:  { label: "Essai gratuit",   color: "bg-blue-50 text-blue-700 ring-blue-200",   Icon: Clock },
    active:    { label: "Actif",           color: "bg-green-50 text-green-700 ring-green-200", Icon: CheckCircle },
    past_due:  { label: "Paiement dû",     color: "bg-red-50 text-red-700 ring-red-200",      Icon: AlertTriangle },
    canceled:  { label: "Résilié",         color: "bg-slate-100 text-slate-600 ring-slate-200", Icon: XCircle },
    unpaid:    { label: "Impayé",          color: "bg-red-50 text-red-700 ring-red-200",      Icon: XCircle },
    incomplete: { label: "Incomplet",      color: "bg-amber-50 text-amber-700 ring-amber-200", Icon: AlertTriangle },
  };
  const cfg = configs[status] ?? configs.canceled;
  const Icon = cfg.Icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

/* ── Message contextuel selon statut ───────────────────────── */
function StatusMessage({
  status,
  cancelAtPeriodEnd,
  currentPeriodEnd,
  trialEndsAt,
}: {
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
}) {
  const fmt = (d: Date) =>
    d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

  if (status === "trialing") {
    const date = trialEndsAt ?? currentPeriodEnd;
    return (
      <p className="text-sm text-slate-600">
        Votre essai gratuit se termine le{" "}
        <strong className="text-slate-900">{date ? fmt(date) : "—"}</strong>.
        Aucun prélèvement ne sera effectué avant cette date.
      </p>
    );
  }

  if (cancelAtPeriodEnd && currentPeriodEnd) {
    return (
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        Votre abonnement a été résilié. Vous conservez l&apos;accès à Gestly jusqu&apos;au{" "}
        <strong>{fmt(currentPeriodEnd)}</strong>, puis votre compte sera désactivé.
      </p>
    );
  }

  if (status === "active" && currentPeriodEnd) {
    return (
      <p className="text-sm text-slate-600">
        Prochain prélèvement de <strong>49 €</strong> le{" "}
        <strong className="text-slate-900">{fmt(currentPeriodEnd)}</strong>.
      </p>
    );
  }

  if (status === "past_due") {
    return (
      <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
        Votre dernier paiement a échoué. Veuillez mettre à jour votre moyen de paiement pour
        conserver l&apos;accès à Gestly.
      </p>
    );
  }

  if (status === "canceled") {
    return (
      <p className="text-sm text-slate-600">
        Votre abonnement est résilié. Pour accéder à nouveau à Gestly, souscrivez un nouvel abonnement.
      </p>
    );
  }

  return null;
}

/* ── Page ───────────────────────────────────────────────────── */
export default async function AbonnementSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const hasSubscription = !!user.stripeSubscriptionId;
  const status = user.subscriptionStatus;
  const cancelAtPeriodEnd = user.stripeCancelAtPeriodEnd;

  // Dates stockées en DB (mises à jour par webhook)
  let currentPeriodEnd: Date | null = user.stripeCurrentPeriodEnd ?? null;
  const trialEndsAt: Date | null = user.trialEndsAt ?? null;

  // Refresh Stripe si les dates DB sont manquantes et qu'un sub existe
  if (hasSubscription && !currentPeriodEnd) {
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId!);
      const ts = sub.items.data[0]?.current_period_end;
      if (ts) currentPeriodEnd = new Date(ts * 1000);
    } catch {
      // Stripe non accessible — on affiche quand même la page
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/parametres"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Paramètres
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mon abonnement</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gérez votre abonnement Gestly, votre moyen de paiement et vos factures.
        </p>
      </div>

      {/* ── État vide : pas encore d'abonnement ─────────── */}
      {!hasSubscription && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="rounded-full bg-slate-100 p-4">
              <CreditCard className="h-8 w-8 text-slate-400" />
            </div>
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">
              Vous n&apos;avez pas encore d&apos;abonnement actif.
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Commencez votre essai gratuit de 14 jours pour accéder à toutes les fonctionnalités.
            </p>
          </div>
          <Link
            href="/abonnement"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
          >
            Choisir une offre
          </Link>
        </div>
      )}

      {/* ── Abonnement existant ──────────────────────────── */}
      {hasSubscription && (
        <>
          {/* Carte abonnement */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">

            {/* En-tête coloré */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Offre actuelle</p>
                <h2 className="text-xl font-bold text-white mt-0.5">Gestly Pro</h2>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-white">49 €</p>
                <p className="text-xs text-blue-200">/ mois</p>
              </div>
            </div>

            {/* Détails */}
            <div className="px-6 py-5 space-y-4">

              {/* Statut */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-600">Statut</span>
                <StatusBadge status={status} cancelAtPeriodEnd={cancelAtPeriodEnd} />
              </div>

              {/* Séparateur */}
              <div className="border-t border-slate-100" />

              {/* Message contextuel */}
              <StatusMessage
                status={status}
                cancelAtPeriodEnd={cancelAtPeriodEnd}
                currentPeriodEnd={currentPeriodEnd}
                trialEndsAt={trialEndsAt}
              />

              {/* Features incluses */}
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  "Devis et factures illimités",
                  "Envoi des devis par WhatsApp",
                  "Suivi des paiements",
                  "Support prioritaire",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

            </div>
          </div>

          {/* Carte portail Stripe */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-xl bg-slate-100 shrink-0">
                <CreditCard className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Gérer mon abonnement</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Vous serez redirigé vers l&apos;espace sécurisé Stripe pour gérer votre abonnement,
                  mettre à jour votre moyen de paiement, télécharger vos factures ou résilier.
                </p>
              </div>
            </div>

            <PortalButton />

            <p className="text-xs text-slate-400 flex items-center gap-1">
              <ExternalLink className="h-3 w-3 shrink-0" />
              La résiliation prend effet à la fin de la période en cours — vous conservez l&apos;accès jusqu&apos;à cette date.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
