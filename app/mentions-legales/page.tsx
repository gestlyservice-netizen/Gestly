export const metadata = {
  title: "Mentions légales — Gestly",
  description: "Mentions légales de l'application Gestly, éditée par DIGITEO SAS.",
};

export default function MentionsLegalesPage() {
  const lastUpdated = "9 juillet 2026";

  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-2xl mx-auto space-y-8 text-slate-800">

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Mentions légales</h1>
          <p className="text-sm text-slate-400 mt-2">Dernière mise à jour : {lastUpdated}</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">1. Éditeur du site</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;application Gestly est éditée par :
          </p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li><strong>DIGITEO</strong>, société par actions simplifiée (SAS) au capital social de 1 €</li>
            <li>Siège social : 68 rue du Faubourg des Postes, 59000 Lille, France</li>
            <li>SIREN : 995 010 063 — SIRET (siège) : 995 010 063 00015</li>
            <li>RCS Lille 995 010 063</li>
            <li>Numéro de TVA intracommunautaire : FR22995010063</li>
            <li>Code APE/NAF : 6201Z — Programmation informatique</li>
            <li>Président et directeur de la publication : Yacine Benessalah</li>
            <li>Contact : <a href="mailto:contact@gestly.fr" className="text-blue-600 hover:underline">contact@gestly.fr</a></li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">2. Hébergement</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;application Gestly est hébergée par :
          </p>
          <ul className="text-sm leading-relaxed text-slate-600 list-disc list-inside space-y-1">
            <li><strong>Vercel Inc.</strong></li>
            <li>440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis</li>
            <li>Site web : <a href="https://vercel.com" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">vercel.com</a></li>
          </ul>
          <p className="text-sm leading-relaxed text-slate-600">
            La base de données est hébergée par Supabase Inc. (infrastructure PostgreSQL, région Europe).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">3. Activité</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            DIGITEO développe et édite des logiciels en mode SaaS (Software as a Service). Gestly est
            un logiciel de gestion de devis et factures à destination des artisans et indépendants,
            proposé sous forme d&apos;abonnement mensuel.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">4. Propriété intellectuelle</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            L&apos;ensemble des éléments constituant le site et l&apos;application Gestly (textes, structure,
            logo, charte graphique, code source) est la propriété exclusive de DIGITEO, sauf mentions
            contraires. Toute reproduction, représentation ou exploitation non autorisée, totale ou
            partielle, est interdite.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">5. Données personnelles</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Le traitement des données personnelles est décrit dans notre{" "}
            <a href="/privacy" className="text-blue-600 hover:underline">politique de confidentialité</a>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">6. Droit applicable</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Les présentes mentions légales sont soumises au droit français. En cas de litige et à
            défaut de résolution amiable, les tribunaux du ressort de Lille seront seuls compétents.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">7. Contact</h2>
          <p className="text-sm leading-relaxed text-slate-600">
            Pour toute question relative à ces mentions légales, contactez-nous à :{" "}
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
