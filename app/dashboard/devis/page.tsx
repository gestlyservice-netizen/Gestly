"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, FileText, Loader2, Eye, Download } from "lucide-react";

interface Devis {
  id: string;
  number: string;
  status: string;
  totalTTC: number;
  createdAt: string;
  client: { name: string };
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  brouillon: { label: "Brouillon", className: "bg-slate-100 text-slate-600" },
  envoye:    { label: "Envoyé",    className: "bg-blue-100 text-blue-700"   },
  signe:     { label: "Signé",     className: "bg-green-100 text-green-700" },
  refuse:    { label: "Refusé",    className: "bg-red-100 text-red-600"     },
};

export default function DevisPage() {
  const router = useRouter();
  const [devis, setDevis] = useState<Devis[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/devis")
      .then((r) => r.json())
      .then(setDevis)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mes devis</h1>
          <p className="text-sm text-slate-500 mt-1">
            {devis.length} devis{devis.length !== 1 ? "" : ""}
          </p>
        </div>
        <Link
          href="/dashboard/devis/nouveau"
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Nouveau devis
        </Link>
      </div>

      {/* Contenu */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : devis.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <FileText className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">Aucun devis pour l&apos;instant</p>
            <p className="text-xs text-slate-400 mt-1">
              Cliquez sur &ldquo;Nouveau devis&rdquo; pour commencer
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Numéro</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total TTC</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {devis.map((d) => {
                const status = STATUS_LABELS[d.status] ?? { label: d.status, className: "bg-slate-100 text-slate-600" };
                return (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-800">{d.number}</td>
                    <td className="px-4 py-3 text-slate-700">{d.client?.name}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${status.className}`}>
                        {status.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {fmt(d.totalTTC)} €
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => router.push(`/dashboard/devis/${d.id}`)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Voir
                        </button>
                        <button
                          onClick={() => window.open(`/print/devis/${d.id}?download=1`, "_blank")}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-2.5 py-1.5 rounded-lg transition-colors"
                          title="Télécharger le PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
