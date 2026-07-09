export const metadata = {
  title: "Conditions Générales d'Utilisation — Gestly",
  description: "Conditions Générales d'Utilisation de l'application Gestly, éditée par DIGITEO SAS.",
};

export default function CguPage() {
  const lastUpdated = "9 juillet 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Conditions Générales d&apos;Utilisation</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Objet</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les présentes Conditions Générales d&apos;Utilisation (CGU) régissent l&apos;accès et
            l&apos;utilisation de l&apos;application Gestly, éditée par DIGITEO, SAS au capital de 1 €,
            immatriculée au RCS de Lille sous le numéro 995 010 063, dont le siège social est situé
            68 rue du Faubourg des Postes, 59000 Lille (ci-après « l&apos;Éditeur »). Toute création de
            compte vaut acceptation pleine et entière des présentes CGU.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Description du service</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Gestly est un logiciel en ligne (SaaS) permettant aux artisans et indépendants de créer
            des devis et factures, gérer leurs clients, envoyer leurs documents par email ou WhatsApp,
            et suivre leurs paiements. Le service est accessible via un compte utilisateur, après
            inscription et souscription d&apos;un abonnement.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Création de compte</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;utilisation de Gestly nécessite la création d&apos;un compte via notre prestataire
            d&apos;authentification (Clerk). L&apos;utilisateur s&apos;engage à fournir des informations
            exactes et à jour, et à assurer la confidentialité de ses identifiants de connexion.
            L&apos;utilisateur est responsable de toute activité effectuée depuis son compte.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Utilisation du service</h2>
          <p className="text-sm leading-relaxed text-slate-600">L&apos;utilisateur s&apos;engage à :</p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li>utiliser Gestly conformément à sa destination (gestion de devis, factures et clients dans le cadre d&apos;une activité professionnelle) ;</li>
            <li>ne pas tenter de contourner les mesures de sécurité du service ;</li>
            <li>ne pas utiliser le service à des fins illégales ou frauduleuses (facturation de complaisance, blanchiment, etc.) ;</li>
            <li>respecter les droits des tiers, notamment dans les données clients qu&apos;il enregistre.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Disponibilité du service</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;Éditeur met en œuvre les moyens raisonnables pour assurer un accès continu au
            service, sans garantie de disponibilité absolue. Des interruptions liées à la maintenance,
            à des mises à jour ou à des circonstances indépendantes de la volonté de l&apos;Éditeur
            (panne d&apos;un prestataire tiers, cas de force majeure) peuvent survenir.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Responsabilité</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;utilisateur reste seul responsable du contenu des devis et factures qu&apos;il émet
            via Gestly, ainsi que de leur conformité aux obligations légales et fiscales applicables à
            son activité. L&apos;Éditeur ne saurait être tenu responsable des conséquences d&apos;une
            utilisation non conforme du service ou d&apos;erreurs dans les données saisies par
            l&apos;utilisateur.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Propriété des données</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les devis, factures et données clients créés par l&apos;utilisateur lui appartiennent.
            L&apos;Éditeur agit en tant que prestataire technique hébergeant ces données pour le compte
            de l&apos;utilisateur, conformément à notre{" "}
            <a href="/privacy" className="text-blue-600 hover:underline">politique de confidentialité</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. Suspension et résiliation</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;Éditeur peut suspendre l&apos;accès au service en cas de non-paiement de
            l&apos;abonnement ou de manquement grave aux présentes CGU. Les modalités de résiliation de
            l&apos;abonnement sont décrites dans nos{" "}
            <a href="/cgv" className="text-blue-600 hover:underline">Conditions Générales de Vente</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">9. Modification des CGU</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;Éditeur se réserve le droit de modifier les présentes CGU. Les utilisateurs seront
            informés de toute modification substantielle. La poursuite de l&apos;utilisation du service
            après notification vaut acceptation des CGU modifiées.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">10. Droit applicable</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les présentes CGU sont soumises au droit français. Tout litige relatif à leur
            interprétation ou leur exécution relève des tribunaux compétents du ressort de Lille.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">11. Contact</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour toute question relative aux présentes CGU, contactez-nous à :{" "}
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
