export const metadata = {
  title: "Politique de confidentialité — Gestly",
  description: "Politique de confidentialité de l'application Gestly",
};

export default function PrivacyPage() {
  const lastUpdated = "20 avril 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Politique de confidentialité</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Présentation</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Gestly est une application de gestion de devis et factures à destination des professionnels
            indépendants et des petites entreprises. Le présent document décrit la manière dont nous
            collectons, utilisons et protégeons vos données personnelles.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Données collectées</h2>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li>Informations de compte : nom, adresse email, nom d'entreprise</li>
            <li>Données clients : noms, emails, numéros de téléphone, adresses</li>
            <li>Documents commerciaux : devis, factures et leurs lignes</li>
            <li>Paramètres de l'entreprise : logo, informations légales, préférences</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Utilisation des données</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les données collectées sont utilisées exclusivement pour :
          </p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li>Fournir les fonctionnalités de l'application (création de devis, factures)</li>
            <li>Envoyer des documents commerciaux à vos clients via email ou WhatsApp</li>
            <li>Générer des PDF à votre intention</li>
            <li>Assurer la sécurité et le bon fonctionnement du service</li>
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
            <li><strong>Vercel</strong> — hébergement de l'application</li>
            <li><strong>Resend</strong> — envoi d'emails transactionnels</li>
            <li><strong>Meta (WhatsApp Business API)</strong> — envoi de messages WhatsApp</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Conservation des données</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Vos données sont conservées tant que votre compte est actif. En cas de suppression
            du compte, l'ensemble des données associées est supprimé dans un délai de 30 jours.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Vos droits (RGPD)</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Conformément au Règlement Général sur la Protection des Données (RGPD), vous disposez
            des droits suivants sur vos données : accès, rectification, suppression, portabilité
            et opposition au traitement. Pour exercer ces droits, contactez-nous à l'adresse
            ci-dessous.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Sécurité</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Toutes les communications entre votre navigateur et nos serveurs sont chiffrées via
            HTTPS/TLS. Les mots de passe ne sont jamais stockés en clair. L'accès à votre compte
            est protégé par le service d'authentification Clerk.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">8. Contact</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour toute question relative à cette politique ou pour exercer vos droits, contactez-nous à :{" "}
            <a href="mailto:contact@gestly.fr" className="text-blue-600 hover:underline">
              contact@gestly.fr
            </a>
          </p>
        </section>

        <div className="border-t border-slate-100 pt-6">
          <p className="text-xs text-slate-400">
            © {new Date().getFullYear()} Gestly — Tous droits réservés
          </p>
        </div>

      </div>
    </main>
  );
}
