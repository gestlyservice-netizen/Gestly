"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Send, Loader2, FileText, Calendar,
  Clock, User, Eye, Download, Pencil, Copy,
  ChevronDown, Check, Receipt, MessageCircle, Phone,
} from "lucide-react";

/* ── Types ─────────────────────────────────────────────── */
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
  clientId: string;
  client: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    preferredContact: string;
  };
  lines: DevisLine[];
}

/* ── Config statuts ─────────────────────────────────────── */
const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-slate-100 text-slate-600" },
  envoye:    { label: "Envoyé",    cls: "bg-blue-100 text-blue-700" },
  signe:     { label: "Signé",     cls: "bg-green-100 text-green-700" },
  refuse:    { label: "Refusé",    cls: "bg-red-100 text-red-600" },
  facture:   { label: "Facturé",   cls: "bg-orange-100 text-orange-700" },
  paye:      { label: "Payé",      cls: "bg-emerald-100 text-emerald-700" },
};

// Transitions possibles par statut
const NEXT_STATUSES: Record<string, { value: string; label: string; cls: string }[]> = {
  brouillon: [{ value: "envoye",   label: "Marquer comme envoyé",  cls: "text-blue-700" }],
  envoye:    [
    { value: "signe",   label: "Marquer comme signé",   cls: "text-green-700" },
    { value: "refuse",  label: "Marquer comme refusé",  cls: "text-red-600"   },
  ],
  signe:     [
    { value: "facture", label: "Marquer comme facturé", cls: "text-orange-700" },
    { value: "brouillon", label: "Repasser en brouillon", cls: "text-slate-600" },
  ],
  facture:   [{ value: "paye",     label: "Marquer comme payé",    cls: "text-emerald-700" }],
  refuse:    [{ value: "brouillon", label: "Repasser en brouillon", cls: "text-slate-600" }],
  paye:      [],
};

/* ── Helpers ────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

/* ── Page ───────────────────────────────────────────────── */
export default function DevisDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [devis, setDevis]             = useState<Devis | null>(null);
  const [loading, setLoading]         = useState(true);
  const [updating, setUpdating]       = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [sending, setSending]         = useState(false);
  const [converting, setConverting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState<string | null>(null);
  const [statusOpen, setStatusOpen]   = useState(false);
  const statusRef                     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/devis/${id}`)
      .then((r) => r.json())
      .then(setDevis)
      .catch(() => setError("Impossible de charger le devis"))
      .finally(() => setLoading(false));
  }, [id]);

  /* Fermer dropdown statut au clic extérieur */
  useEffect(() => {
    if (!statusOpen) return;
    function close(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node))
        setStatusOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [statusOpen]);

  const notify = (msg: string, isError = false) => {
    if (isError) setError(msg);
    else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  /* Changer le statut */
  const changeStatus = async (status: string) => {
    setUpdating(true);
    setStatusOpen(false);
    try {
      const res = await fetch(`/api/devis/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) setDevis(await res.json());
      else {
        const j = await res.json().catch(() => ({}));
        notify(j.error ?? "Erreur lors de la mise à jour", true);
      }
    } finally {
      setUpdating(false);
    }
  };

  /* Envoyer selon le canal préféré du client */
  const sendToClient = async () => {
    if (!devis) return;
    const channel = devis.client.preferredContact ?? "email";
    setSending(true);
    try {
      if (channel === "whatsapp") {
        if (!devis.client.phone) {
          notify("Ce client n'a pas de numéro de téléphone pour WhatsApp.", true);
          return;
        }
        const rawPhone = devis.client.phone!.replace(/\s/g, "");
        const normalizedPhone = rawPhone.startsWith("0")
          ? "+33" + rawPhone.slice(1)
          : rawPhone;
        const amount = devis.totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2 });
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://gestly-iota.vercel.app";
        const pdfLink = `${appUrl}/d/${devis.id}`;
        const message = [
          `Bonjour ${devis.client.name},`,
          `Votre devis ${devis.number} d'un montant de ${amount} € est prêt.`,
          `N'hésitez pas à nous contacter pour toute question.`,
          ``,
          pdfLink,
        ].join("\n");
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: normalizedPhone, message }),
        });
        if (res.ok) {
          notify(`Devis envoyé par WhatsApp à ${devis.client.phone}`);
        } else {
          const j = await res.json().catch(() => ({}));
          notify(j.error ?? "Échec de l'envoi WhatsApp", true);
        }
      } else {
        const res = await fetch(`/api/devis/${id}/send`, { method: "POST" });
        if (res.ok) {
          setDevis(await res.json());
          notify(`Devis envoyé par email à ${devis.client.email}`);
        } else {
          const j = await res.json().catch(() => ({}));
          notify(j.error ?? "Échec de l'envoi email", true);
        }
      }
    } finally {
      setSending(false);
    }
  };

  /* Transformer en facture */
  const convertToFacture = async () => {
    setConverting(true);
    try {
      const res = await fetch(`/api/devis/${id}/to-facture`, { method: "POST" });
      if (res.ok) {
        const facture = await res.json();
        router.push(`/dashboard/factures/${facture.id}`);
      } else {
        const j = await res.json().catch(() => ({}));
        notify(j.error ?? "Erreur lors de la transformation", true);
      }
    } finally {
      setConverting(false);
    }
  };

  /* Dupliquer */
  const duplicate = async () => {
    setDuplicating(true);
    try {
      const res = await fetch(`/api/devis/${id}/duplicate`, { method: "POST" });
      if (res.ok) {
        const copy = await res.json();
        router.push(`/dashboard/devis/${copy.id}`);
      } else {
        const j = await res.json().catch(() => ({}));
        notify(j.error ?? "Erreur lors de la duplication", true);
      }
    } finally {
      setDuplicating(false);
    }
  };

  /* ── États de chargement ── */
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

  const status = STATUS_CONFIG[devis.status] ?? { label: devis.status, cls: "bg-slate-100 text-slate-600" };
  const nextStatuses = NEXT_STATUSES[devis.status] ?? [];
  const busy = updating || duplicating || sending || converting;

  return (
    <div className="max-w-4xl mx-auto space-y-5">

      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
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
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.cls}`}>
                {status.label}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Créé le {fmtDate(devis.createdAt)}</p>
          </div>
        </div>

        {/* ── Boutons d'action ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Modifier */}
          <Link
            href={`/dashboard/devis/${devis.id}/modifier`}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Modifier
          </Link>

          {/* Aperçu PDF */}
          <a
            href={`/print/devis/${devis.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Eye className="h-4 w-4" />
            Aperçu
          </a>

          {/* Télécharger PDF */}
          <button
            onClick={() => window.open(`/print/devis/${devis.id}?download=1`, "_blank")}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            PDF
          </button>

          {/* Envoyer selon canal préféré */}
          {(() => {
            const channel = devis.client.preferredContact ?? "email";
            const canSend =
              (channel === "whatsapp" && !!devis.client.phone) ||
              (channel === "email" && !!devis.client.email) ||
              (channel === "telephone" && false);
            if (!canSend) return null;
            const icon = sending
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : channel === "whatsapp"
                ? <MessageCircle className="h-4 w-4" />
                : <Send className="h-4 w-4" />;
            const label = channel === "whatsapp" ? "WhatsApp" : "Envoyer";
            return (
              <button
                onClick={sendToClient}
                disabled={busy}
                className={`inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                  channel === "whatsapp"
                    ? "bg-green-50 border border-green-200 text-green-700 hover:bg-green-100"
                    : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {icon}
                {label}
              </button>
            );
          })()}

          {/* Dupliquer */}
          <button
            onClick={duplicate}
            disabled={busy}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {duplicating
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Copy className="h-4 w-4" />}
            Dupliquer
          </button>

          {/* Transformer en facture */}
          {devis.status === "signe" && (
            <button
              onClick={convertToFacture}
              disabled={busy}
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 shadow-sm"
            >
              {converting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Receipt className="h-4 w-4" />}
              Transformer en facture
            </button>
          )}

          {/* Changer le statut (dropdown) */}
          {nextStatuses.length > 0 && (
            <div ref={statusRef} className="relative">
              <button
                onClick={() => setStatusOpen((v) => !v)}
                disabled={busy}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3.5 py-2 rounded-lg transition-colors disabled:opacity-50"
              >
                {updating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                Statut
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${statusOpen ? "rotate-180" : ""}`} />
              </button>
              {statusOpen && (
                <div className="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5">
                  {nextStatuses.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => changeStatus(s.value)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium hover:bg-slate-50 transition-colors ${s.cls}`}
                    >
                      <Check className="h-3.5 w-3.5" />
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Notifications ─────────────────────────────── */}
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          ✓ {success}
        </div>
      )}

      {/* ── Infos client + devis ───────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Client */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <User className="h-3.5 w-3.5" /> Client
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-900">{devis.client.name}</p>
            {(() => {
              const ch = devis.client.preferredContact ?? "email";
              const cfg = {
                whatsapp:  { label: "WhatsApp",  cls: "bg-green-50 text-green-700 border-green-200", icon: <MessageCircle className="h-3 w-3" /> },
                email:     { label: "Email",     cls: "bg-blue-50 text-blue-700 border-blue-200",    icon: <Send className="h-3 w-3" /> },
                telephone: { label: "Téléphone", cls: "bg-slate-50 text-slate-600 border-slate-200", icon: <Phone className="h-3 w-3" /> },
              }[ch] ?? { label: "Email", cls: "bg-blue-50 text-blue-700 border-blue-200", icon: <Send className="h-3 w-3" /> };
              return (
                <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.cls}`}>
                  {cfg.icon} {cfg.label}
                </span>
              );
            })()}
          </div>
          {devis.client.email && (
            <p className="text-sm text-slate-500 mt-1">{devis.client.email}</p>
          )}
          {devis.client.phone && (
            <p className="text-sm text-slate-500">{devis.client.phone}</p>
          )}
          {devis.client.address && (
            <p className="text-xs text-slate-400 mt-1">{devis.client.address}</p>
          )}
        </div>

        {/* Infos devis */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            <Calendar className="h-3.5 w-3.5" /> Devis
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Créé le</span>
              <span className="font-medium text-slate-800">{fmtDate(devis.createdAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Envoyé le</span>
              <span className="font-medium text-slate-800">{fmtDate(devis.sentAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Signé le</span>
              <span className="font-medium text-slate-800">{fmtDate(devis.signedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 flex items-center gap-1">
                <Clock className="h-3 w-3" /> Validité
              </span>
              <span className="font-medium text-slate-800">{devis.validityDays} jours</span>
            </div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {devis.notes && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Notes</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{devis.notes}</p>
        </div>
      )}

      {/* ── Lignes du devis ───────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-700">Lignes du devis</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Description
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Qté
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Prix HT
              </th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                TVA
              </th>
              <th className="text-right px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Total HT
              </th>
            </tr>
          </thead>
          <tbody>
            {devis.lines.map((line) => (
              <tr key={line.id} className="border-b border-slate-50 last:border-0">
                <td className="px-5 py-3.5 text-slate-800">{line.description}</td>
                <td className="px-4 py-3.5 text-right text-slate-600 tabular-nums">{line.quantity}</td>
                <td className="px-4 py-3.5 text-right text-slate-600 tabular-nums">
                  {fmt(line.unitPriceHT)}&nbsp;€
                </td>
                <td className="px-4 py-3.5 text-right text-slate-600">{line.tvaRate}&nbsp;%</td>
                <td className="px-5 py-3.5 text-right font-semibold text-slate-800 tabular-nums">
                  {fmt(line.totalHT)}&nbsp;€
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totaux */}
        <div className="px-5 py-5 flex justify-end border-t border-slate-100 bg-slate-50/50">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total HT</span>
              <span className="font-medium text-slate-900 tabular-nums">{fmt(devis.totalHT)}&nbsp;€</span>
            </div>
            <div className="flex justify-between text-sm text-slate-600">
              <span>Total TVA</span>
              <span className="font-medium text-slate-900 tabular-nums">{fmt(devis.totalTVA)}&nbsp;€</span>
            </div>
            <div className="border-t border-slate-200 pt-2 flex justify-between">
              <span className="font-bold text-slate-900">Total TTC</span>
              <span className="text-xl font-bold text-blue-600 tabular-nums">{fmt(devis.totalTTC)}&nbsp;€</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
