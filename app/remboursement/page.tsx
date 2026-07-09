export const metadata = {
  title: "Politique de remboursement — Gestly",
  description: "Politique de remboursement de l'abonnement Gestly, édité par DIGITEO SAS.",
};

export default function RemboursementPage() {
  const lastUpdated = "9 juillet 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Politique de remboursement</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Essai gratuit avant tout paiement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Chaque nouvel abonnement Gestly bénéficie d&apos;un essai gratuit de 14 jours. Aucun
            prélèvement n&apos;a lieu pendant cette période, même si un moyen de paiement est enregistré
            dès l&apos;inscription. Vous pouvez annuler à tout moment durant l&apos;essai, depuis votre
            espace client, sans qu&apos;aucun montant ne soit débité.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Après le premier prélèvement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Une fois l&apos;essai gratuit terminé et le premier prélèvement effectué, les mensualités
            déjà payées ne sont pas remboursables, y compris en cas de résiliation en cours de mois.
            La résiliation met simplement fin aux prélèvements futurs : vous conservez l&apos;accès au
            service jusqu&apos;à la fin de la période déjà payée (voir nos{" "}
            <a href="/cgv" className="text-blue-600 hover:underline">Conditions Générales de Vente</a>).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Erreur de facturation</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Si vous constatez un prélèvement anormal (double facturation, montant incorrect, ou
            prélèvement après une résiliation effective), contactez-nous sans délai. Après vérification,
            tout montant prélevé par erreur imputable à DIGITEO vous sera intégralement remboursé.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Comment demander un remboursement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Toute demande doit être adressée à{" "}
            <a href="mailto:contact@gestly.fr" className="text-blue-600 hover:underline">
              contact@gestly.fr
            </a>{" "}
            en précisant la nature du problème rencontré. Nous nous engageons à répondre sous 5 jours
            ouvrés.
          </p>
        </section>

        <div className="border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} DIGITEO — Gestly. Tous droits réservés.
          </p>
        </div>

      </div>
    </main>
  );
}
