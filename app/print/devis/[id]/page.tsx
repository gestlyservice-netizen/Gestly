"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Printer } from "lucide-react";

interface DevisLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceHT: number;
  tvaRate: number;
  totalHT: number;
}

interface Devis {
  id: string;
  number: string;
  status: string;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  validityDays: number;
  notes: string | null;
  createdAt: string;
  sentAt: string | null;
  client: { name: string; email: string | null; phone: string | null; address: string | null };
  lines: DevisLine[];
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

export default function PrintDevisPage() {
  const { id } = useParams<{ id: string }>();
  const [devis, setDevis] = useState<Devis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/devis/${id}`)
      .then((r) => r.json())
      .then(setDevis)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!devis) {
    return <div className="flex items-center justify-center h-screen text-slate-500">Devis introuvable.</div>;
  }

  const expiryDate = new Date(devis.createdAt);
  expiryDate.setDate(expiryDate.getDate() + devis.validityDays);

  return (
    <>
      {/* Barre d'actions — masquée à l'impression */}
      <div className="print:hidden fixed top-0 left-0 right-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => window.close()}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Fermer
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Printer className="h-4 w-4" />
          Télécharger / Imprimer PDF
        </button>
      </div>

      {/* Document */}
      <div className="print:pt-0 pt-16 bg-slate-100 min-h-screen print:bg-white">
        <div className="max-w-[794px] mx-auto bg-white print:shadow-none shadow-xl my-8 print:my-0 print:max-w-full">
          <div className="p-12 print:p-8">

            {/* En-tête du document */}
            <div className="flex justify-between items-start mb-10">
              <div>
                <div className="text-2xl font-bold text-blue-600 mb-1">Gestly</div>
                <div className="text-xs text-slate-400">Votre entreprise</div>
              </div>
              <div className="text-right">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">DEVIS</h1>
                <p className="text-lg font-mono font-semibold text-blue-600 mt-1">{devis.number}</p>
                <p className="text-sm text-slate-500 mt-1">Date : {fmtDate(devis.createdAt)}</p>
                <p className="text-sm text-slate-500">Validité : {fmtDate(expiryDate.toISOString())}</p>
              </div>
            </div>

            {/* Client */}
            <div className="flex justify-end mb-10">
              <div className="bg-slate-50 rounded-xl px-6 py-4 min-w-[240px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Destinataire</p>
                <p className="font-bold text-slate-900">{devis.client.name}</p>
                {devis.client.address && (
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{devis.client.address}</p>
                )}
                {devis.client.email && (
                  <p className="text-sm text-slate-500 mt-1">{devis.client.email}</p>
                )}
                {devis.client.phone && (
                  <p className="text-sm text-slate-500">{devis.client.phone}</p>
                )}
              </div>
            </div>

            {/* Tableau des lignes */}
            <table className="w-full mb-8 text-sm">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="text-left px-4 py-3 rounded-tl-lg font-semibold">Description</th>
                  <th className="text-right px-4 py-3 font-semibold">Qté</th>
                  <th className="text-right px-4 py-3 font-semibold">Prix HT</th>
                  <th className="text-right px-4 py-3 font-semibold">TVA</th>
                  <th className="text-right px-4 py-3 rounded-tr-lg font-semibold">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {devis.lines.map((line, i) => (
                  <tr key={line.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-4 py-3 text-slate-800">{line.description}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{line.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(line.unitPriceHT)} €</td>
                    <td className="px-4 py-3 text-right text-slate-500">{line.tvaRate} %</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(line.totalHT)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Totaux */}
            <div className="flex justify-end mb-10">
              <div className="w-72">
                <div className="flex justify-between py-2 text-sm text-slate-600 border-b border-slate-100">
                  <span>Total HT</span>
                  <span className="font-medium text-slate-800">{fmt(devis.totalHT)} €</span>
                </div>
                <div className="flex justify-between py-2 text-sm text-slate-600 border-b border-slate-100">
                  <span>Total TVA</span>
                  <span className="font-medium text-slate-800">{fmt(devis.totalTVA)} €</span>
                </div>
                <div className="flex justify-between py-3 bg-blue-600 text-white rounded-lg px-4 mt-2">
                  <span className="font-bold text-base">Total TTC</span>
                  <span className="font-bold text-xl">{fmt(devis.totalTTC)} €</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {devis.notes && (
              <div className="border-t border-slate-100 pt-6 mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{devis.notes}</p>
              </div>
            )}

            {/* Pied de page */}
            <div className="border-t border-slate-100 pt-6 text-xs text-slate-400 text-center">
              <p>Devis valable {devis.validityDays} jours à compter du {fmtDate(devis.createdAt)}.</p>
              <p className="mt-1">Pour accepter ce devis, veuillez nous contacter ou signer et retourner ce document.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
