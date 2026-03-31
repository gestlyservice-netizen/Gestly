"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { FadeIn } from "./fade-in";

const faqs = [
  {
    q: "Quels métiers peuvent utiliser Gestly ?",
    a: "Gestly est conçu pour tous les artisans et indépendants : plombiers, électriciens, peintres, nettoyage professionnel, paysagistes, maçons, menuisiers, et bien d'autres. Si vous émettez des devis et des factures, Gestly est fait pour vous.",
  },
  {
    q: "Combien coûte Gestly après l'essai gratuit ?",
    a: "Après les 14 jours d'essai gratuit, Gestly Pro est à 49 €/mois. Pour les 100 premiers inscrits, profitez d'un tarif préférentiel à 34 €/mois à vie. Sans engagement, annulation possible à tout moment.",
  },
  {
    q: "Comment fonctionne le bot WhatsApp ?",
    a: "Vous envoyez un message vocal ou texte à Gestly sur WhatsApp (ex : \"Devis Dupont salle de bain 3200 €\"). L'IA comprend votre demande, génère le devis PDF professionnel et vous l'envoie en moins de 30 secondes. Zéro saisie, zéro formation.",
  },
  {
    q: "Est-ce conforme à la facturation électronique 2027 ?",
    a: "Oui. Gestly génère des factures au format Factur-X, conforme aux obligations de facturation électronique qui entreront en vigueur en 2027 pour toutes les entreprises françaises. Votre conformité est assurée dès maintenant.",
  },
  {
    q: "Puis-je annuler à tout moment ?",
    a: "Absolument. Aucun engagement, aucune période minimale. Vous pouvez annuler votre abonnement en 1 clic depuis votre espace client, à tout moment. Vos données restent accessibles pendant 30 jours après l'annulation.",
  },
  {
    q: "Mes données sont-elles sécurisées ?",
    a: "Vos données sont hébergées en Europe, chiffrées en transit et au repos. Gestly est conforme au RGPD. Nous ne vendons ni ne partageons jamais vos données avec des tiers. Vos devis et factures vous appartiennent.",
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section id="faq" className="py-24 bg-[#F8FAFC]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <FadeIn className="text-center mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
            Questions fréquentes
          </h2>
        </FadeIn>

        <div className="space-y-3">
          {faqs.map((faq, i) => (
            <FadeIn key={i} delay={i * 60}>
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button
                  className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-slate-50 transition-colors"
                  onClick={() => setOpenIndex(openIndex === i ? null : i)}
                >
                  <span className="font-medium text-[#0F172A] pr-4">{faq.q}</span>
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 text-slate-400 shrink-0 transition-transform duration-300",
                      openIndex === i && "rotate-180"
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "overflow-hidden transition-all duration-300 ease-in-out",
                    openIndex === i ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  )}
                >
                  <p className="px-6 pb-5 text-[#64748B] text-sm leading-relaxed">
                    {faq.a}
                  </p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}
