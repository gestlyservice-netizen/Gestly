"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader2, User, Calendar,
  FileText, Download, Send, CheckCircle,
} from "lucide-react";
import { generateFacturePDF } from "@/lib/generate-pdf";

/* ── Types ──────────────────────────────────────────────── */
interface Line {
  id:          string;
  description: string;
  quantity:    number;
  unitPriceHT: number;
  tvaRate:     number;
  totalHT:     number;
}

interface Facture {
  id:        string;
  number:    string;
  status:    string;
  totalHT:   number;
  totalTVA:  number;
  totalTTC:  number;
  notes:     string | null;
  dueDate:   string | null;
  createdAt: string;
  paidAt:    string | null;
  client: {
    name:    string;
    email:   string | null;
    phone:   string | null;
    address: string | null;
  };
  lines: Line[];
  devis: {
    id:     string;
    number: string;
    lines:  Line[];
  } | null;
}

/* ── Helpers ─────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

function getDisplayStatus(f: Facture): { label: string; cls: string } {
  if (f.status === "payee") return { label: "Payée", cls: "bg-green-100 text-green-700" };
  if (f.dueDate && new Date(f.dueDate) < new Date())
    return { label: "En retard", cls: "bg-red-100 text-red-600" };
  const daysSince = (Date.now() - new Date(f.createdAt).getTime()) / 86_400_000;
  if (!f.dueDate && daysSince > 30) return { label: "En retard", cls: "bg-red-100 text-red-600" };
  return { label: "Émise", cls: "bg-blue-100 text-blue-700" };
}

/* ── Page ────────────────────────────────────────────────── */
export default function FactureDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [facture, setFacture] = useState<Facture | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying]   = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/factures/${id}`)
      .then((r) => r.json())
      .then(setFacture)
      .catch(() => setError("Impossible de charger la facture"))
      .finally(() => setLoading(false));
  }, [id]);

  const notify = (msg: string, isError = false) => {
    if (isError) setError(msg);
    else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  const markAsPaid = async () => {
    if (!facture || facture.status === "payee") return;
    setPaying(true);
    try {
      const res = await fetch(`/api/factures/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "mark_paid" }),
      });
      if (res.ok) {
        setFacture(await res.json());
        notify("Facture marquée comme payée");
      } else {
        const j = await res.json().catch(() => ({})) as { error?: string };
        notify(j.error ?? "Erreur lors de la mise à jour", true);
      }
    } finally {
      setPaying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!facture) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Facture introuvable.</p>
        <Link href="/dashboard/factures" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          Retour à la liste
        </Link>
      </div>
    );
  }

  const status = getDisplayStatus(facture);
  // Priorité : lignes propres de la facture, sinon lignes du devis lié
  const lines  = facture.lines.length > 0 ? facture.lines : (facture.devis?.lines ?? []);

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/factures"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 font-mono">{facture.number}</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Émise le {fmtDate(facture.createdAt)}</p>
          </div>
        </div>

        {/* Boutons d'action */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => generateFacturePDF(facture.id)}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>

          {facture.client.email && (
            <a
              href={`mailto:${facture.client.email}?subject=Facture ${facture.number}&body=Bonjour,%0A%0AVeuillez trouver ci-joint votre facture ${facture.number}.%0A%0ACordialement`}
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
            >
              <Send className="h-4 w-4" />
              Envoyer
            </a>
          )}

          {facture.status !== "payee" && (
            <button
              onClick={markAsPaid}
              disabled={paying}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Marquer comme payée
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>
      )}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">✓ {success}</div>
      )}

      {/* Facture acquittée */}
      {facture.status === "payee" && facture.paidAt && (
        <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            Facture acquittée le {fmtDate(facture.paidAt)}
          </p>
        </div>
      )}

      {/* ── Infos client + facture ───────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <User className="h-3.5 w-3.5" /> Client
          </div>
          <p className="font-semibold text-slate-900">{facture.client.name}</p>
          {facture.client.email   && <p className="text-sm text-slate-500 mt-1">{facture.client.email}</p>}
          {facture.client.phone   && <p className="text-sm text-slate-500">{facture.client.phone}</p>}
          {facture.client.address && <p className="text-xs text-slate-400 mt-1">{facture.client.address}</p>}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <Calendar className="h-3.5 w-3.5" /> Facture
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Émise le</span>
              <span className="font-medium text-slate-800">{fmtDate(facture.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Échéance</span>
              <span className="font-medium text-slate-800">{fmtDate(facture.dueDate)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Payée le</span>
              <span className="font-medium text-slate-800">{fmtDate(facture.paidAt)}</span>
            </div>
            {facture.devis && (
              <div className="flex justify-between">
                <span className="text-slate-500">Devis d&apos;origine</span>
                <Link
                  href={`/dashboard/devis/${facture.devis.id}`}
                  className="font-medium text-blue-600 hover:underline font-mono text-xs"
                >
                  {facture.devis.number}
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      {facture.notes && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{facture.notes}</p>
        </div>
      )}

      {/* ── Prestations ─────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Détail des prestations</h2>
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Aucune ligne disponible.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Description</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Qté</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Prix HT</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">TVA</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3.5 text-slate-800">{line.description}</td>
                  <td className="px-4 py-3.5 text-right text-slate-600 tabular-nums">{line.quantity}</td>
                  <td className="px-4 py-3.5 text-right text-slate-600 tabular-nums">{fmt(line.unitPriceHT)}&nbsp;€</td>
                  <td className="px-4 py-3.5 text-right text-slate-600">{line.tvaRate}&nbsp;%</td>
                  <td className="px-5 py-3.5 text-right font-semibold text-slate-800 tabular-nums">{fmt(line.totalHT)}&nbsp;€</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="px-5 py-5 flex justify-end border-t border-slate-100 bg-slate-50/50">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total HT</span>
              <span className="font-medium text-slate-900 tabular-nums">{fmt(facture.totalHT)}&nbsp;€</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total TVA</span>
              <span className="font-medium text-slate-900 tabular-nums">{fmt(facture.totalTVA)}&nbsp;€</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="font-bold text-slate-900">Total TTC</span>
              <span className="text-xl font-bold text-blue-600 tabular-nums">{fmt(facture.totalTTC)}&nbsp;€</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
