"use client";

import { useState } from "react";
import Link from "next/link";

export function CheckoutButton({
  label,
  requireConsent = false,
}: {
  label: string;
  requireConsent?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/create-checkout-session", { method: "POST" });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        setError(data.error ?? "Une erreur est survenue. Réessayez.");
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion et réessayez.");
    } finally {
      setLoading(false);
    }
  }

  const disabled = loading || (requireConsent && !consent);

  return (
    <div className="space-y-3">
      {requireConsent && (
        <label className="flex items-start gap-2.5 text-left text-xs text-slate-500 leading-relaxed">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span>
            J&apos;accepte les{" "}
            <Link href="/cgu" target="_blank" className="text-blue-600 hover:underline">CGU</Link>
            {", les "}
            <Link href="/cgv" target="_blank" className="text-blue-600 hover:underline">CGV</Link>
            {" et la "}
            <Link href="/privacy" target="_blank" className="text-blue-600 hover:underline">
              Politique de confidentialité
            </Link>
          </span>
        </label>
      )}
      <button
        onClick={handleClick}
        disabled={disabled}
        className="w-full inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? "Chargement..." : label}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
