export const metadata = {
  title: "Politique de confidentialité — Gestly",
  description: "Politique de confidentialité de l'application Gestly",
};

export default function PrivacyPage() {
  const lastUpdated = "9 juillet 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Politique de confidentialité</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Responsable de traitement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Gestly est une application de gestion de devis et factures à destination des professionnels
            indépendants et des petites entreprises, éditée par <strong>DIGITEO</strong>, société par
            actions simplifiée (SAS) au capital de 1 €, immatriculée au RCS de Lille sous le numéro
            995 010 063, dont le siège social est situé 68 rue du Faubourg des Postes, 59000 Lille,
            France (« nous », « l&apos;Éditeur »). DIGITEO est responsable du traitement des données
            personnelles décrit dans le présent document.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Données collectées</h2>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li>Informations de compte : nom, adresse email, nom d&apos;entreprise</li>
            <li>Données clients : noms, emails, numéros de téléphone, adresses</li>
            <li>Documents commerciaux : devis, factures et leurs lignes</li>
            <li>Paramètres de l&apos;entreprise : logo, informations légales, préférences</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Finalités et bases légales des traitements</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Chaque traitement de données repose sur une base légale définie par le RGPD :
          </p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li><strong>Exécution du contrat</strong> — fournir les fonctionnalités de l&apos;application (création de devis, factures, gestion de clients), générer les PDF, gérer votre abonnement</li>
            <li><strong>Exécution du contrat</strong> — envoyer, à votre demande, des documents commerciaux à vos clients via email ou WhatsApp</li>
            <li><strong>Intérêt légitime</strong> — assurer la sécurité, la prévention de la fraude et le bon fonctionnement du service</li>
            <li><strong>Obligation légale</strong> — conserver les données de facturation conformément aux obligations comptables et fiscales</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Partage des données</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Nous ne vendons ni ne louons vos données à des tiers. Les données peuvent être
            transmises aux prestataires suivants dans le cadre strict de la fourniture du service :
          </p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li><strong>Clerk</strong> — authentification des utilisateurs</li>
            <li><strong>Supabase / PostgreSQL</strong> — hébergement de la base de données</li>
            <li><strong>Vercel</strong> — hébergement de l&apos;application</li>
            <li><strong>Resend</strong> — envoi d&apos;emails transactionnels</li>
            <li><strong>Meta (WhatsApp Business API)</strong> — envoi de messages WhatsApp</li>
            <li><strong>Stripe</strong> — traitement des paiements et gestion de l&apos;abonnement</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Durée de conservation</h2>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li><strong>Données de compte</strong> (nom, email, entreprise) — conservées tant que votre compte est actif</li>
            <li><strong>Devis, factures et données clients</strong> — conservés tant que votre compte est actif, puis pendant la durée légale de conservation des documents comptables (10 ans à compter de la clôture de l&apos;exercice, conformément au Code de commerce)</li>
            <li><strong>Données de paiement</strong> — gérées directement par Stripe selon sa propre politique de conservation ; DIGITEO ne stocke aucune donnée de carte bancaire</li>
          </ul>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour demander la suppression de votre compte et des données non soumises à une obligation
            légale de conservation, contactez-nous à l&apos;adresse indiquée ci-dessous : nous
            traiterons votre demande dans les meilleurs délais.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Vos droits (RGPD)</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez
            des droits suivants sur vos données : accès, rectification, suppression, portabilité
            et opposition au traitement. Pour exercer ces droits, contactez-nous à l&apos;adresse
            ci-dessous.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Sécurité</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Toutes les communications entre votre navigateur et nos serveurs sont chiffrées via
            HTTPS/TLS. Les mots de passe ne sont jamais stockés en clair. L&apos;accès à votre compte
            est protégé par le service d&apos;authentification Clerk.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. Contact</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour toute question relative à cette politique ou pour exercer vos droits, contactez-nous à :{" "}
            <a href="mailto:contact@gestly.fr" className="text-blue-600 hover:underline">
              contact@gestly.fr
            </a>
            . L&apos;identité complète de l&apos;Éditeur figure dans nos{" "}
            <a href="/mentions-legales" className="text-blue-600 hover:underline">mentions légales</a>.
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
