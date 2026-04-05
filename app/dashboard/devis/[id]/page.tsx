"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Send, CheckCircle, XCircle, Loader2,
  FileText, Calendar, Clock, User, Eye, Download, Pencil,
} from "lucide-react";


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
  signedAt: string | null;
  client: { id: string; name: string; email: string | null; phone: string | null; address: string | null };
  lines: DevisLine[];
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  brouillon: { label: "Brouillon",  className: "bg-slate-100 text-slate-600"  },
  envoye:    { label: "Envoyé",     className: "bg-blue-100 text-blue-700"    },
  signe:     { label: "Signé",      className: "bg-green-100 text-green-700"  },
  refuse:    { label: "Refusé",     className: "bg-red-100 text-red-600"      },
};

export default function DevisDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [devis, setDevis] = useState<Devis | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendSuccess, setSendSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/devis/${id}`)
      .then((r) => r.json())
      .then(setDevis)
      .catch(() => setError("Impossible de charger le devis"))
      .finally(() => setLoading(false));
  }, [id]);

  const sendByEmail = async () => {
    setSending(true);
    setError(null);
    setSendSuccess(false);
    try {
      const res = await fetch(`/api/devis/${id}/send`, { method: "POST" });
      if (res.ok) {
        const updated = await res.json();
        setDevis(updated);
        setSendSuccess(true);
        setTimeout(() => setSendSuccess(false), 4000);
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Échec de l'envoi");
      }
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: string) => {
    setUpdating(status);
    setError(null);
    try {
      const res = await fetch(`/api/devis/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        setDevis(await res.json());
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Erreur lors de la mise à jour");
      }
    } finally {
      setUpdating(null);
    }
  };

  const fmt = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString("fr-FR") : "—";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!devis) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Devis introuvable.</p>
        <Link href="/dashboard/devis" className="text-blue-600 hover:underline text-sm mt-2 inline-block">
          Retour à la liste
        </Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[devis.status] ?? { label: devis.status, className: "bg-slate-100 text-slate-600" };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/devis"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900 font-mono">{devis.number}</h1>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              Créé le {fmtDate(devis.createdAt)}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/dashboard/devis/${devis.id}/modifier`}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Modifier
          </Link>
          <a
            href={`/print/devis/${devis.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors"
          >
            <Eye className="h-4 w-4" />
            Aperçu PDF
          </a>
          <button
            onClick={() => window.open(`/print/devis/${devis.id}?download=1`, "_blank")}
            disabled={!!updating}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
          >
            <Download className="h-4 w-4" />
            Télécharger PDF
          </button>
          {devis.client.email && (
            <button
              onClick={sendByEmail}
              disabled={sending || !!updating}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {sending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
              Envoyer par email
            </button>
          )}
          {devis.status === "brouillon" && (
            <button
              onClick={() => changeStatus("envoye")}
              disabled={!!updating}
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              {updating === "envoye"
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
              Marquer comme envoyé
            </button>
          )}
          {devis.status === "envoye" && (
            <>
              <button
                onClick={() => changeStatus("signe")}
                disabled={!!updating}
                className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {updating === "signe"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle className="h-4 w-4" />}
                Marquer comme signé
              </button>
              <button
                onClick={() => changeStatus("refuse")}
                disabled={!!updating}
                className="inline-flex items-center gap-2 border border-red-300 text-red-600 hover:bg-red-50 text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
              >
                {updating === "refuse"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <XCircle className="h-4 w-4" />}
                Refusé
              </button>
            </>
          )}
          {(devis.status === "signe" || devis.status === "refuse") && (
            <button
              onClick={() => changeStatus("brouillon")}
              disabled={!!updating}
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-4 py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              Repasser en brouillon
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}
      {sendSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          ✓ Devis envoyé avec succès à <strong>{devis.client.email}</strong>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Client */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <User className="h-3.5 w-3.5" /> Client
          </div>
          <p className="font-semibold text-slate-900">{devis.client.name}</p>
          {devis.client.email && <p className="text-sm text-slate-500 mt-1">{devis.client.email}</p>}
          {devis.client.phone && <p className="text-sm text-slate-500">{devis.client.phone}</p>}
          {devis.client.address && <p className="text-sm text-slate-400 mt-1 text-xs">{devis.client.address}</p>}
        </div>

        {/* Dates */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <Calendar className="h-3.5 w-3.5" /> Dates
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Créé le</span>
              <span className="text-slate-800 font-medium">{fmtDate(devis.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Envoyé le</span>
              <span className="text-slate-800 font-medium">{fmtDate(devis.sentAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Signé le</span>
              <span className="text-slate-800 font-medium">{fmtDate(devis.signedAt)}</span>
            </div>
          </div>
        </div>

        {/* Validité */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <Clock className="h-3.5 w-3.5" /> Validité
          </div>
          <p className="text-3xl font-bold text-slate-900">{devis.validityDays}</p>
          <p className="text-sm text-slate-500">jours</p>
        </div>
      </div>

      {/* Lignes */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Lignes du devis</h2>
        </div>
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
            {devis.lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-50">
                <td className="px-5 py-3 text-slate-800">{line.description}</td>
                <td className="px-4 py-3 text-right text-slate-600">{line.quantity}</td>
                <td className="px-4 py-3 text-right text-slate-600">{fmt(line.unitPriceHT)} €</td>
                <td className="px-4 py-3 text-right text-slate-600">{line.tvaRate} %</td>
                <td className="px-5 py-3 text-right font-semibold text-slate-800">{fmt(line.totalHT)} €</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totaux */}
        <div className="px-5 py-5 flex justify-end border-t border-slate-100">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total HT</span>
              <span className="font-medium text-slate-900">{fmt(devis.totalHT)} €</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total TVA</span>
              <span className="font-medium text-slate-900">{fmt(devis.totalTVA)} €</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="font-bold text-slate-900">Total TTC</span>
              <span className="text-xl font-bold text-blue-600">{fmt(devis.totalTTC)} €</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {devis.notes && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Notes</h2>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{devis.notes}</p>
        </div>
      )}
    </div>
  );
}
