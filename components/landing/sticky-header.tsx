"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export function StickyHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  return (
    <header
      className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
        scrolled
          ? "bg-white/95 backdrop-blur-sm shadow-sm border-b border-slate-100"
          : "bg-transparent"
      )}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-xl font-bold text-[#2563EB]">Gestly</span>
        </Link>

        {/* Nav desktop */}
        <nav className="hidden md:flex items-center gap-8">
          {["Fonctionnalités", "Tarifs", "FAQ"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace("é", "e").replace("î", "i")}`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              {item}
            </a>
          ))}
        </nav>

        {/* CTA desktop */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/sign-in"
            className="text-sm font-medium text-slate-700 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-lg transition-colors"
          >
            Connexion
          </Link>
          <Link
            href="/sign-up"
            className="text-sm font-semibold text-white bg-[#2563EB] hover:bg-[#1D4ED8] px-4 py-2 rounded-lg transition-colors shadow-sm"
          >
            Essai gratuit
          </Link>
        </div>

        {/* Hamburger */}
        <button
          className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t border-slate-100 px-4 py-4 space-y-3">
          {["Fonctionnalités", "Tarifs", "FAQ"].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase().replace("é", "e")}`}
              className="block text-sm font-medium text-slate-700 py-2"
              onClick={() => setMobileOpen(false)}
            >
              {item}
            </a>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            <Link
              href="/sign-in"
              className="text-center text-sm font-medium text-slate-700 border border-slate-300 px-4 py-2.5 rounded-lg"
              onClick={() => setMobileOpen(false)}
            >
              Connexion
            </Link>
            <Link
              href="/sign-up"
              className="text-center text-sm font-semibold text-white bg-[#2563EB] px-4 py-2.5 rounded-lg"
              onClick={() => setMobileOpen(false)}
            >
              Essai gratuit
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
