import Link from "next/link";
import { Mail, ArrowLeft, MapPin } from "lucide-react";

export const metadata = {
  title: "Contact — Gestly",
  description: "Contactez l'équipe Gestly pour toute question sur le produit, votre abonnement ou vos données.",
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-xl mx-auto space-y-8 text-slate-800">

        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <div>
          <h1 className="text-3xl font-bold text-slate-900">Contact</h1>
          <p className="text-slate-500 mt-2">
            Une question sur Gestly, votre abonnement, une facture ou vos données personnelles ?
            Nous vous répondons sous 48h ouvrées.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 space-y-4">
          <a
            href="mailto:contact@gestly.fr"
            className="flex items-center gap-3 text-slate-900 font-medium hover:text-blue-600 transition-colors"
          >
            <span className="rounded-full bg-blue-50 p-2.5">
              <Mail className="h-5 w-5 text-blue-600" />
            </span>
            contact@gestly.fr
          </a>
          <div className="flex items-start gap-3 text-slate-600 text-sm">
            <span className="rounded-full bg-slate-100 p-2.5 shrink-0">
              <MapPin className="h-5 w-5 text-slate-500" />
            </span>
            <span>
              DIGITEO — 68 rue du Faubourg des Postes, 59000 Lille, France
              <br />
              <Link href="/mentions-legales" className="text-blue-600 hover:underline">Mentions légales</Link>
            </span>
          </div>
        </div>

        <div className="text-sm text-slate-500 space-y-2">
          <p>Pour aller plus vite selon votre demande :</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Question sur votre abonnement ou une facture Stripe → gérez-le directement depuis <Link href="/dashboard/parametres/abonnement" className="text-blue-600 hover:underline">votre espace abonnement</Link></li>
            <li>Question sur la confidentialité de vos données → consultez notre <Link href="/privacy" className="text-blue-600 hover:underline">politique de confidentialité</Link></li>
            <li>Question fréquente → consultez la <Link href="/#faq" className="text-blue-600 hover:underline">FAQ</Link></li>
          </ul>
        </div>

      </div>
    </main>
  );
}
