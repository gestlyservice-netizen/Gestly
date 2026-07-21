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
    a: "Après les 14 jours d'essai gratuit, Gestly Pro est à 49 €/mois, sans engagement. Vous pouvez annuler à tout moment depuis votre espace client.",
  },
  {
    q: "Puis-je envoyer mes devis par WhatsApp ?",
    a: "Oui. Une fois votre devis créé dans Gestly, vous pouvez l'envoyer à votre client par email ou directement par WhatsApp en un clic — il reçoit un lien vers le PDF professionnel.",
  },
  {
    q: "Est-ce conforme à la facturation électronique 2027 ?",
    a: "Pas encore. Gestly génère aujourd'hui des devis et factures PDF professionnels avec toutes les mentions légales obligatoires. Le format Factur-X requis par la réforme de facturation électronique (obligatoire pour toutes les entreprises d'ici 2027) n'est pas encore disponible — nous vous informerons dès son intégration.",
  },
  {
    q: "Puis-je annuler à tout moment ?",
    a: "Absolument. Aucun engagement, aucune période minimale. Vous pouvez annuler votre abonnement depuis votre espace client, à tout moment, et vous conservez l'accès jusqu'à la fin de la période déjà payée.",
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
