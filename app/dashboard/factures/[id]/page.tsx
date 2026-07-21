"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader2, User, Calendar,
  FileText, Download, Send, CheckCircle, Undo2,
} from "lucide-react";
import { generateFacturePDF } from "@/lib/generate-pdf";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

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
  sentAt:    string | null;
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

interface Avoir {
  id:        string;
  number:    string;
  type:      string;
  reason:    string;
  totalTTC:  number;
  createdAt: string;
}

interface RelanceHistoryItem {
  id:        string;
  niveau:    number;
  canal:     string;
  statut:    string;
  erreur:    string | null;
  envoyeeAt: string;
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

  const [facture, setFacture]   = useState<Facture | null>(null);
  const [loading, setLoading]   = useState(true);
  const [paying, setPaying]     = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [success, setSuccess]   = useState<string | null>(null);

  const [sendOpen,    setSendOpen]    = useState(false);
  const [sendTo,      setSendTo]      = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendMessage, setSendMessage] = useState("");
  const [sending,     setSending]     = useState(false);
  const [sendError,   setSendError]   = useState<string | null>(null);

  const [avoirs,       setAvoirs]       = useState<Avoir[]>([]);
  const [relances,     setRelances]     = useState<RelanceHistoryItem[]>([]);
  const [avoirOpen,    setAvoirOpen]    = useState(false);
  const [avoirType,    setAvoirType]    = useState<"total" | "partiel">("total");
  const [avoirReason,  setAvoirReason]  = useState("");
  const [avoirDesc,    setAvoirDesc]    = useState("");
  const [avoirAmount,  setAvoirAmount]  = useState("");
  const [avoirTva,     setAvoirTva]     = useState("20");
  const [creatingAvoir, setCreatingAvoir] = useState(false);
  const [avoirError,   setAvoirError]   = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    fetch(`/api/factures/${id}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) {
          setError((data as { error?: string }).error ?? `Erreur ${r.status}`);
        } else {
          setFacture(data as Facture);
        }
      })
      .catch(() => setError("Impossible de charger la facture"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/factures/${id}/avoir`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setAvoirs(data as Avoir[]))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/factures/${id}/relances`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setRelances(data as RelanceHistoryItem[]))
      .catch(() => {});
  }, [id]);

  const notify = (msg: string, isError = false) => {
    if (isError) setError(msg);
    else setSuccess(msg);
    setTimeout(() => { setError(null); setSuccess(null); }, 4000);
  };

  const openSendDialog = () => {
    if (!facture) return;
    setSendTo(facture.client.email ?? "");
    setSendSubject(`Facture ${facture.number} — Gestly`);
    setSendMessage(
      `Bonjour ${facture.client.name},\n\nVeuillez trouver ci-joint votre facture ${facture.number} d'un montant de ${fmt(facture.totalTTC)} € TTC.\n\nCordialement,`
    );
    setSendError(null);
    setSendOpen(true);
  };

  const sendFacture = async () => {
    if (!facture) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await fetch(`/api/factures/${id}/send`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ to: sendTo, subject: sendSubject, message: sendMessage }),
      });
      const data = await r.json();
      if (r.ok) {
        setFacture(data as Facture);
        setSendOpen(false);
        notify("Facture envoyée par email");
      } else {
        setSendError((data as { error?: string }).error ?? "Échec de l'envoi");
      }
    } catch {
      setSendError("Erreur réseau lors de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const openAvoirDialog = () => {
    setAvoirType("total");
    setAvoirReason("");
    setAvoirDesc("");
    setAvoirAmount("");
    setAvoirTva("20");
    setAvoirError(null);
    setAvoirOpen(true);
  };

  const createAvoir = async () => {
    if (!facture) return;
    setCreatingAvoir(true);
    setAvoirError(null);
    try {
      const payload =
        avoirType === "total"
          ? { type: "total", reason: avoirReason }
          : {
              type: "partiel",
              reason: avoirReason,
              description: avoirDesc,
              unitPriceHT: Number(avoirAmount),
              tvaRate: Number(avoirTva),
            };
      const r = await fetch(`/api/factures/${id}/avoir`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      const data = await r.json();
      if (r.ok) {
        setAvoirs((prev) => [data as Avoir, ...prev]);
        setAvoirOpen(false);
        notify("Avoir créé");
      } else {
        setAvoirError((data as { error?: string }).error ?? "Échec de la création de l'avoir");
      }
    } catch {
      setAvoirError("Erreur réseau");
    } finally {
      setCreatingAvoir(false);
    }
  };

  const markAsPaid = async () => {
    if (!facture || facture.status === "payee") return;
    setPaying(true);
    try {
      const r = await fetch(`/api/factures/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: "mark_paid" }),
      });
      const data = await r.json();
      if (r.ok) {
        setFacture(data as Facture);
        notify("Facture marquée comme payée");
      } else {
        notify((data as { error?: string }).error ?? "Erreur lors de la mise à jour", true);
      }
    } catch {
      notify("Erreur réseau", true);
    } finally {
      setPaying(false);
    }
  };

  /* ── États de chargement ───────────────────────────────── */
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error && !facture) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link
            href="/dashboard/factures"
            className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Détail de la facture</h1>
        </div>
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {error}
        </div>
        <div className="mt-4">
          <Link
            href="/dashboard/factures"
            className="text-sm text-blue-600 hover:underline"
          >
            ← Retour à la liste des factures
          </Link>
        </div>
      </div>
    );
  }

  if (!facture) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-500">Facture introuvable.</p>
        <Link
          href="/dashboard/factures"
          className="text-blue-600 hover:underline text-sm mt-2 inline-block"
        >
          Retour à la liste
        </Link>
      </div>
    );
  }

  const status = getDisplayStatus(facture);
  /* Priorité : lignes propres de la facture, sinon lignes du devis lié */
  const lines = (facture.lines ?? []).length > 0
    ? facture.lines
    : (facture.devis?.lines ?? []);

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

          <button
            onClick={openSendDialog}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Send className="h-4 w-4" />
            Envoyer par email
          </button>

          <button
            onClick={openAvoirDialog}
            className="inline-flex items-center gap-2 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2 rounded-lg transition-colors"
          >
            <Undo2 className="h-4 w-4" />
            Créer un avoir
          </button>

          {facture.status !== "payee" && (
            <button
              onClick={markAsPaid}
              disabled={paying}
              className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {paying
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle className="h-4 w-4" />}
              Marquer comme payée
            </button>
          )}
        </div>
      </div>

      {/* Notifications */}
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
            <div className="flex justify-between">
              <span className="text-slate-500">Envoyée le</span>
              <span className="font-medium text-slate-800">{fmtDate(facture.sentAt)}</span>
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

      {/* ── Avoirs ─────────────────────────────────────────── */}
      {avoirs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Undo2 className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Avoirs émis sur cette facture</h2>
          </div>
          <ul className="divide-y divide-slate-50">
            {avoirs.map((a) => (
              <li key={a.id} className="px-5 py-3.5 flex items-center justify-between text-sm">
                <div>
                  <span className="font-mono font-semibold text-slate-800">{a.number}</span>
                  <span className="text-slate-400 ml-2">
                    {a.type === "total" ? "Avoir total" : "Avoir partiel"} · {fmtDate(a.createdAt)}
                  </span>
                  <p className="text-xs text-slate-400 mt-0.5">{a.reason}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold text-slate-800 tabular-nums">-{fmt(a.totalTTC)}&nbsp;€</span>
                  <a
                    href={`/api/avoirs/${a.id}/pdf`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-600 hover:underline text-xs font-medium"
                  >
                    PDF
                  </a>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Historique des relances ────────────────────────── */}
      {relances.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <Send className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Historique des relances</h2>
          </div>
          <ul className="divide-y divide-slate-50">
            {relances.map((r) => (
              <li key={r.id} className="px-5 py-3 flex items-center justify-between text-sm">
                <div>
                  <span className="font-semibold text-slate-800">Niveau {r.niveau}</span>
                  <span className="text-slate-400 ml-2 uppercase text-xs">{r.canal}</span>
                  <span className="text-slate-400 ml-2">· {fmtDate(r.envoyeeAt)}</span>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  r.statut === "envoyee" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"
                }`}>
                  {r.statut === "envoyee" ? "Envoyée" : `Échec${r.erreur ? ` — ${r.erreur}` : ""}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Dialog création avoir ─────────────────────────── */}
      <Dialog open={avoirOpen} onOpenChange={setAvoirOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Créer un avoir</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAvoirType("total")}
                className={`flex-1 text-sm font-medium py-2 rounded-lg border transition-colors ${
                  avoirType === "total"
                    ? "bg-blue-50 border-blue-300 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                Avoir total
              </button>
              <button
                type="button"
                onClick={() => setAvoirType("partiel")}
                className={`flex-1 text-sm font-medium py-2 rounded-lg border transition-colors ${
                  avoirType === "partiel"
                    ? "bg-blue-50 border-blue-300 text-blue-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                Avoir partiel
              </button>
            </div>

            {avoirType === "partiel" && (
              <>
                <div className="space-y-1.5">
                  <Label>Description de la ligne créditée</Label>
                  <Input value={avoirDesc} onChange={(e) => setAvoirDesc(e.target.value)} placeholder="Ex : Remise commerciale" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Montant HT</Label>
                    <Input type="number" min="0" step="0.01" value={avoirAmount} onChange={(e) => setAvoirAmount(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>TVA %</Label>
                    <Input type="number" min="0" step="0.1" value={avoirTva} onChange={(e) => setAvoirTva(e.target.value)} />
                  </div>
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label>Raison de l&apos;avoir</Label>
              <Textarea
                rows={3}
                value={avoirReason}
                onChange={(e) => setAvoirReason(e.target.value)}
                placeholder="Ex : Erreur de tarification, geste commercial, prestation annulée…"
              />
            </div>
            <p className="text-xs text-slate-400">
              La facture d&apos;origine n&apos;est jamais modifiée. L&apos;avoir vient s&apos;y référencer et sera déduit de votre chiffre d&apos;affaires.
            </p>
            {avoirError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {avoirError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={createAvoir}
              disabled={creatingAvoir || !avoirReason.trim() || (avoirType === "partiel" && (!avoirDesc.trim() || !avoirAmount))}
              className="inline-flex items-center gap-2"
            >
              {creatingAvoir ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
              {creatingAvoir ? "Création…" : "Créer l'avoir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog envoi email ────────────────────────────── */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Envoyer la facture par email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Destinataire</Label>
              <Input
                type="email"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                placeholder="client@exemple.fr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Objet</Label>
              <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={5} value={sendMessage} onChange={(e) => setSendMessage(e.target.value)} />
            </div>
            <p className="text-xs text-slate-400">Le PDF de la facture sera joint automatiquement.</p>
            {sendError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {sendError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={sendFacture}
              disabled={sending || !sendTo.trim()}
              className="inline-flex items-center gap-2"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {sending ? "Envoi…" : "Envoyer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
