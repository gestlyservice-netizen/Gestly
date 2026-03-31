import Link from "next/link";
import {
  ArrowRight,
  Play,
  Clock,
  AlertTriangle,
  TrendingDown,
  MessageSquare,
  Zap,
  Receipt,
  Check,
  Star,
  Mail,
  Phone,
  ExternalLink,
  Shield,
} from "lucide-react";
import { StickyHeader } from "@/components/landing/sticky-header";
import { FadeIn } from "@/components/landing/fade-in";
import { FaqSection } from "@/components/landing/faq-section";

/* ─── DASHBOARD MOCKUP ─────────────────────────────────── */
function DashboardMockup() {
  return (
    <div className="w-full max-w-xl mx-auto">
      {/* Browser chrome */}
      <div className="rounded-2xl overflow-hidden shadow-2xl shadow-blue-200/50 border border-slate-200 bg-white">
        {/* Title bar */}
        <div className="bg-slate-100 px-4 py-3 flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="h-3 w-3 rounded-full bg-red-400" />
            <div className="h-3 w-3 rounded-full bg-amber-400" />
            <div className="h-3 w-3 rounded-full bg-green-400" />
          </div>
          <div className="flex-1 bg-white rounded-md px-3 py-1 text-xs text-slate-400 text-center">
            app.gestly.fr/dashboard
          </div>
        </div>
        {/* App content */}
        <div className="flex h-64 sm:h-80">
          {/* Sidebar */}
          <div className="w-14 sm:w-44 bg-white border-r border-slate-100 p-2 sm:p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-blue-50 mb-2">
              <div className="h-3 w-3 rounded bg-blue-500 shrink-0" />
              <div className="hidden sm:block h-2 w-16 bg-blue-400 rounded" />
            </div>
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <div className="h-3 w-3 rounded bg-slate-200 shrink-0" />
                <div className="hidden sm:block h-2 w-12 bg-slate-200 rounded" />
              </div>
            ))}
          </div>
          {/* Main */}
          <div className="flex-1 p-3 sm:p-4 bg-slate-50">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                { label: "Devis", value: "12", color: "bg-blue-500" },
                { label: "CA mois", value: "8 400€", color: "bg-green-500" },
                { label: "Signés", value: "7", color: "bg-violet-500" },
                { label: "Impayés", value: "0€", color: "bg-red-400" },
              ].map((s) => (
                <div key={s.label} className="bg-white rounded-lg p-2 sm:p-3 border border-slate-100">
                  <div className={`h-1.5 w-6 rounded mb-1.5 ${s.color}`} />
                  <div className="text-[10px] sm:text-xs font-bold text-slate-800">{s.value}</div>
                  <div className="text-[9px] sm:text-[10px] text-slate-400">{s.label}</div>
                </div>
              ))}
            </div>
            {/* Table */}
            <div className="bg-white rounded-lg border border-slate-100 overflow-hidden">
              {[
                { name: "Dupont - Salle de bain", amount: "3 200€", badge: "Signé", color: "bg-green-100 text-green-700" },
                { name: "Martin - Cuisine", amount: "5 800€", badge: "En attente", color: "bg-amber-100 text-amber-700" },
                { name: "Bernard - WC", amount: "890€", badge: "Envoyé", color: "bg-blue-100 text-blue-700" },
              ].map((row) => (
                <div key={row.name} className="flex items-center justify-between px-2 sm:px-3 py-1.5 border-b border-slate-50 last:border-0">
                  <div className="h-2 w-20 sm:w-28 bg-slate-200 rounded" />
                  <div className={`text-[8px] sm:text-[10px] font-medium px-1.5 py-0.5 rounded-full ${row.color}`}>
                    {row.badge}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-white text-[#0F172A] overflow-x-hidden">
      <StickyHeader />

      {/* ── SECTION 2 : HERO ─────────────────────────────── */}
      <section className="pt-32 pb-24 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Left */}
            <div className="flex-1 text-center lg:text-left space-y-6">
              <FadeIn delay={0}>
                <div className="inline-flex items-center gap-2 bg-blue-50 text-[#2563EB] text-sm font-medium px-4 py-2 rounded-full border border-blue-100">
                  <Shield className="h-3.5 w-3.5" />
                  Conforme facturation électronique 2027
                </div>
              </FadeIn>

              <FadeIn delay={100}>
                <h1 className="text-4xl sm:text-5xl xl:text-6xl font-extrabold leading-tight tracking-tight text-[#0F172A]">
                  Ne perdez plus jamais
                  <br />
                  un chantier.
                  <br />
                  <span className="text-[#2563EB]">Gestly relance</span>
                  <br />
                  <span className="text-[#2563EB]">pour vous.</span>
                </h1>
              </FadeIn>

              <FadeIn delay={200}>
                <p className="text-lg sm:text-xl text-[#64748B] leading-relaxed max-w-xl mx-auto lg:mx-0">
                  Créez vos devis en 30 secondes depuis WhatsApp.
                  Factures conformes, relances automatiques par IA,
                  pilotage complet de votre activité.
                </p>
              </FadeIn>

              <FadeIn delay={300}>
                <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
                  <Link
                    href="/sign-up"
                    className="inline-flex items-center justify-center gap-2 bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold px-6 py-3.5 rounded-xl transition-all shadow-lg shadow-blue-200 hover:shadow-blue-300 hover:-translate-y-0.5"
                  >
                    Essai gratuit 14 jours
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="#fonctionnalites"
                    className="inline-flex items-center justify-center gap-2 text-[#0F172A] font-semibold border border-slate-300 hover:border-slate-400 bg-white px-6 py-3.5 rounded-xl transition-all hover:-translate-y-0.5"
                  >
                    <Play className="h-4 w-4 text-[#2563EB]" />
                    Voir la démo
                  </Link>
                </div>
              </FadeIn>
            </div>

            {/* Right – mockup */}
            <FadeIn delay={200} className="flex-1 w-full lg:w-auto">
              <DashboardMockup />
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 : SOCIAL PROOF ─────────────────────── */}
      <section className="py-14 bg-[#F8FAFC] border-y border-slate-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <FadeIn>
            <p className="text-sm font-medium text-[#64748B] uppercase tracking-widest mb-6">
              Plus de 100 artisans font confiance à Gestly
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {["Plombiers", "Électriciens", "Peintres", "Nettoyage", "Paysagistes"].map((m) => (
                <span
                  key={m}
                  className="bg-white border border-slate-200 text-slate-600 text-sm font-medium px-4 py-2 rounded-full shadow-sm"
                >
                  {m}
                </span>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── SECTION 4 : PROBLÈME ─────────────────────────── */}
      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
              Vous perdez du temps et de l&apos;argent
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                icon: Clock,
                stat: "5h",
                unit: "par semaine",
                desc: "perdues en paperasse administrative",
              },
              {
                icon: AlertTriangle,
                stat: "18 000 €",
                unit: "par an",
                desc: "de chantiers perdus faute de relances",
              },
              {
                icon: TrendingDown,
                stat: "45 jours",
                unit: "en moyenne",
                desc: "de délai de paiement pour les artisans",
              },
            ].map((item, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="text-center p-8 rounded-2xl border border-red-100 bg-red-50/40 hover:shadow-md transition-shadow">
                  <item.icon className="h-8 w-8 text-red-500 mx-auto mb-4" />
                  <div className="text-4xl font-extrabold text-[#0F172A] mb-1">{item.stat}</div>
                  <div className="text-sm font-medium text-red-600 mb-2">{item.unit}</div>
                  <p className="text-sm text-[#64748B]">{item.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 5 : SOLUTION ─────────────────────────── */}
      <section id="fonctionnalites" className="py-24 px-4 sm:px-6 bg-[#F8FAFC]">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
              Gestly résout tout ça en un seul outil
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                icon: MessageSquare,
                title: "Devis par WhatsApp",
                desc: "Dites simplement \"Devis Dupont salle de bain 3200\" et recevez le PDF en 30 secondes. Zéro formation nécessaire.",
              },
              {
                icon: Zap,
                title: "Relances automatiques IA",
                desc: "Gestly relance vos clients par SMS au bon moment avec le bon message. Vous ne perdez plus jamais un devis.",
              },
              {
                icon: Receipt,
                title: "Facture conforme en 1 clic",
                desc: "Transformez un devis signé en facture Factur-X conforme instantanément. Prêt pour 2027.",
              },
            ].map((card, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white rounded-2xl p-8 border border-slate-200 hover:border-[#2563EB]/30 hover:shadow-lg transition-all duration-300 group h-full">
                  <div className="h-12 w-12 rounded-xl bg-blue-50 flex items-center justify-center mb-5 group-hover:bg-blue-100 transition-colors">
                    <card.icon className="h-6 w-6 text-[#2563EB]" />
                  </div>
                  <h3 className="text-lg font-bold text-[#0F172A] mb-3">{card.title}</h3>
                  <p className="text-[#64748B] text-sm leading-relaxed">{card.desc}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 6 : COMMENT CA MARCHE ───────────────── */}
      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
              3 étapes, zéro prise de tête
            </h2>
          </FadeIn>
          <div className="space-y-8">
            {[
              {
                n: "01",
                title: "Parlez à Gestly sur WhatsApp",
                desc: "Envoyez vos instructions en message texte ou vocal. L'IA comprend et exécute.",
              },
              {
                n: "02",
                title: "Recevez votre devis PDF",
                desc: "En 30 secondes, le devis professionnel est généré et envoyé sur WhatsApp.",
              },
              {
                n: "03",
                title: "Gestly gère la suite",
                desc: "Relances automatiques, signature, transformation en facture. Vous faites votre métier.",
              },
            ].map((step, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="flex items-start gap-6 p-6 sm:p-8 rounded-2xl border border-slate-100 hover:border-blue-100 hover:shadow-sm transition-all bg-white">
                  <div className="text-5xl font-extrabold text-[#2563EB]/15 leading-none shrink-0 w-16">
                    {step.n}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-[#0F172A] mb-2">{step.title}</h3>
                    <p className="text-[#64748B] text-sm leading-relaxed">{step.desc}</p>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 7 : TARIF ───────────────────────────── */}
      <section id="tarifs" className="py-24 px-4 sm:px-6 bg-[#F8FAFC]">
        <div className="max-w-lg mx-auto">
          <FadeIn className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
              Un prix simple et transparent
            </h2>
          </FadeIn>
          <FadeIn delay={100}>
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
              {/* Card header */}
              <div className="px-8 pt-8 pb-6 border-b border-slate-100">
                <span className="inline-block bg-[#2563EB] text-white text-xs font-bold px-3 py-1 rounded-full mb-4">
                  Populaire
                </span>
                <h3 className="text-2xl font-bold text-[#0F172A] mb-4">Gestly Pro</h3>
                <div className="flex items-end gap-2 mb-1">
                  <span className="text-2xl text-[#64748B] line-through">49 €</span>
                  <span className="text-5xl font-extrabold text-[#0F172A]">34 €</span>
                  <span className="text-[#64748B] mb-1">/mois</span>
                </div>
                <p className="text-sm text-[#2563EB] font-medium">
                  Pour les 100 premiers — tarif à vie 🎉
                </p>
              </div>
              {/* Features */}
              <ul className="px-8 py-6 space-y-3">
                {[
                  "Devis et factures illimités",
                  "Bot WhatsApp IA",
                  "Relances SMS automatiques",
                  "Signature électronique",
                  "Pipeline de suivi",
                  "Génération PDF professionnelle",
                  "Conforme facturation électronique",
                  "Support prioritaire",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-[#0F172A]">
                    <div className="h-5 w-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                      <Check className="h-3 w-3 text-green-600" />
                    </div>
                    {f}
                  </li>
                ))}
              </ul>
              {/* CTA */}
              <div className="px-8 pb-8">
                <Link
                  href="/sign-up"
                  className="block w-full text-center bg-[#2563EB] hover:bg-[#1D4ED8] text-white font-semibold py-4 rounded-xl transition-all hover:-translate-y-0.5 shadow-lg shadow-blue-200"
                >
                  Commencer mon essai gratuit
                </Link>
                <p className="text-center text-xs text-[#64748B] mt-3">
                  14 jours gratuits · sans carte bancaire · annulation en 1 clic
                </p>
              </div>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── SECTION 8 : TÉMOIGNAGES ─────────────────────── */}
      <section className="py-24 px-4 sm:px-6 bg-white">
        <div className="max-w-5xl mx-auto">
          <FadeIn className="text-center mb-16">
            <h2 className="text-3xl sm:text-4xl font-bold text-[#0F172A]">
              Ce que disent les artisans
            </h2>
          </FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              {
                quote: "J'ai récupéré 2 chantiers le premier mois juste grâce aux relances automatiques.",
                name: "Karim M.",
                job: "Plombier-chauffagiste",
              },
              {
                quote: "Mes clients me disent que mes devis font très professionnel. Ça change tout.",
                name: "Sophie L.",
                job: "Nettoyage professionnel",
              },
              {
                quote: "Créer un devis depuis WhatsApp sur le chantier c'est magique. Je ne reviens pas en arrière.",
                name: "Thomas R.",
                job: "Électricien",
              },
            ].map((t, i) => (
              <FadeIn key={i} delay={i * 100}>
                <div className="bg-white rounded-2xl p-8 border border-slate-200 hover:shadow-md transition-all h-full flex flex-col">
                  <div className="text-5xl text-[#2563EB] font-serif leading-none mb-4">&ldquo;</div>
                  <p className="text-[#0F172A] italic text-sm leading-relaxed flex-1 mb-6">
                    {t.quote}
                  </p>
                  <div className="border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-sm text-[#0F172A]">{t.name}</p>
                        <p className="text-xs text-[#64748B]">{t.job}</p>
                      </div>
                      <div className="flex gap-0.5">
                        {[...Array(5)].map((_, j) => (
                          <Star key={j} className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 9 : FAQ ─────────────────────────────── */}
      <FaqSection />

      {/* ── SECTION 10 : CTA FINAL ──────────────────────── */}
      <section className="py-24 px-4 sm:px-6 bg-gradient-to-br from-[#2563EB] to-[#1D4ED8] text-white">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <FadeIn>
            <h2 className="text-3xl sm:text-4xl font-bold">
              Prêt à ne plus perdre de chantiers ?
            </h2>
          </FadeIn>
          <FadeIn delay={100}>
            <p className="text-blue-100 text-lg">
              Rejoignez les artisans qui gagnent du temps et de l&apos;argent avec Gestly.
            </p>
          </FadeIn>
          <FadeIn delay={200}>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 bg-white text-[#2563EB] font-bold px-8 py-4 rounded-xl hover:bg-blue-50 transition-all hover:-translate-y-0.5 shadow-xl"
            >
              Essai gratuit 14 jours
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="text-blue-200 text-sm mt-4">
              Sans engagement · sans carte bancaire
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────── */}
      <footer className="bg-[#0F172A] text-slate-400 py-16 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
            {/* Logo col */}
            <div className="col-span-2 sm:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-8 w-8 rounded-lg bg-[#2563EB] flex items-center justify-center">
                  <Zap className="h-4 w-4 text-white" />
                </div>
                <span className="text-xl font-bold text-white">Gestly</span>
              </div>
              <p className="text-sm leading-relaxed mb-4">
                Le CRM tout-en-un pour artisans et indépendants.
              </p>
              <div className="flex gap-3">
                <a href="#" className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors">
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a href="#" className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center transition-colors">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>

            {/* Produit */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">Produit</h4>
              <ul className="space-y-2 text-sm">
                {["Fonctionnalités", "Tarifs", "Démo"].map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:text-white transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Ressources */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">Ressources</h4>
              <ul className="space-y-2 text-sm">
                {["Blog", "FAQ", "Contact"].map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:text-white transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal & Contact */}
            <div>
              <h4 className="text-white font-semibold text-sm mb-4">Légal</h4>
              <ul className="space-y-2 text-sm mb-6">
                {["CGV", "Mentions légales", "Confidentialité"].map((l) => (
                  <li key={l}>
                    <a href="#" className="hover:text-white transition-colors">{l}</a>
                  </li>
                ))}
              </ul>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5" />
                  <span>contact@gestly.fr</span>
                </div>
                <div className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  <span>WhatsApp</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800 pt-8 text-center text-sm">
            © 2026 Gestly — Tous droits réservés
          </div>
        </div>
      </footer>
    </div>
  );
}
