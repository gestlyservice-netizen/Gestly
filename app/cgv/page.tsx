export const metadata = {
  title: "Conditions Générales de Vente — Gestly",
  description: "Conditions Générales de Vente de l'abonnement Gestly, édité par DIGITEO SAS.",
};

export default function CgvPage() {
  const lastUpdated = "9 juillet 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Conditions Générales de Vente</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Objet et champ d&apos;application</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les présentes Conditions Générales de Vente (CGV) régissent la souscription à
            l&apos;abonnement Gestly, service édité par DIGITEO, SAS au capital de 1 €, immatriculée au
            RCS de Lille sous le numéro 995 010 063, dont le siège social est situé 68 rue du Faubourg
            des Postes, 59000 Lille (ci-après « l&apos;Éditeur »). Elles s&apos;appliquent à toute
            souscription réalisée par un professionnel (artisan, indépendant, entreprise) dans le
            cadre de son activité, à l&apos;exclusion de toute relation de consommation au sens du Code
            de la consommation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Offre et tarifs</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;offre « Gestly Pro » est proposée au prix affiché lors de la souscription, actuellement
            <strong> 49 € par mois</strong>, sans engagement de durée. Les tarifs sont indiqués au moment
            de la souscription sur la page de paiement sécurisée Stripe. L&apos;Éditeur se réserve le
            droit de modifier ses tarifs pour l&apos;avenir ; toute modification sera communiquée aux
            abonnés avant son entrée en vigueur et ne s&apos;appliquera pas rétroactivement à la période
            déjà facturée.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Essai gratuit</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Toute nouvelle souscription bénéficie d&apos;un essai gratuit de 14 jours. Un moyen de
            paiement est demandé dès la souscription, mais aucun prélèvement n&apos;est effectué avant
            la fin de la période d&apos;essai. L&apos;utilisateur peut annuler à tout moment pendant
            l&apos;essai, depuis son espace client, sans qu&apos;aucun montant ne soit débité.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Paiement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Le paiement est traité par notre prestataire Stripe, prestataire de services de paiement
            agréé. DIGITEO ne stocke aucune donnée de carte bancaire. L&apos;abonnement est facturé
            mensuellement, par prélèvement automatique sur le moyen de paiement enregistré, à
            échéance de chaque période mensuelle. Une facture est mise à disposition de l&apos;utilisateur
            via le portail client Stripe.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Durée et résiliation</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;abonnement est sans engagement de durée et se renouvelle automatiquement chaque mois.
            L&apos;utilisateur peut résilier à tout moment depuis le portail client Stripe, accessible
            depuis son espace Gestly. La résiliation prend effet à la fin de la période déjà payée :
            l&apos;utilisateur conserve l&apos;accès au service jusqu&apos;à cette date, sans reconduction
            ni prélèvement ultérieur.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Défaut de paiement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            En cas d&apos;échec de prélèvement, l&apos;accès au service peut être suspendu jusqu&apos;à
            régularisation du moyen de paiement. L&apos;utilisateur est informé par email et peut mettre
            à jour son moyen de paiement à tout moment depuis le portail client Stripe.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Remboursement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les modalités de remboursement sont décrites dans notre{" "}
            <a href="/remboursement" className="text-blue-600 hover:underline">politique de remboursement</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. Droit de rétractation</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;abonnement Gestly étant souscrit par un professionnel pour les besoins de son
            activité, il n&apos;est pas soumis au droit de rétractation prévu par le Code de la
            consommation pour les contrats conclus avec des consommateurs. L&apos;essai gratuit de 14
            jours (article 3) permet néanmoins à tout souscripteur de tester le service sans engagement
            avant tout prélèvement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">9. Responsabilité</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            La responsabilité de l&apos;Éditeur ne saurait être engagée au-delà des sommes effectivement
            versées par l&apos;utilisateur au titre de l&apos;abonnement au cours des douze derniers
            mois, sauf en cas de faute lourde ou intentionnelle de l&apos;Éditeur.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">10. Droit applicable et litiges</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les présentes CGV sont soumises au droit français. À défaut de résolution amiable, tout
            litige relève de la compétence exclusive des tribunaux du ressort de Lille.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">11. Contact</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour toute question relative à votre abonnement ou aux présentes CGV, contactez-nous à :{" "}
            <a href="mailto:contact@gestly.fr" className="text-blue-600 hover:underline">
              contact@gestly.fr
            </a>
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
