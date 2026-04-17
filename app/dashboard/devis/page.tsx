"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, FileText, Loader2, Eye, Pencil, Copy,
  Download, Trash2, MoreVertical, Search,
  Clock, CheckCircle2, TrendingUp, Banknote,
  List, Columns, ChevronDown, AlertTriangle,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/* ── Types ─────────────────────────────────────────────── */
interface DevisLine {
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
  createdAt: string;
  signedAt: string | null;
  clientId: string;
  validityDays: number;
  notes: string | null;
  client: { name: string };
  lines: DevisLine[];
}

/* ── Statuts ────────────────────────────────────────────── */
const STATUS_CONFIG: Record<string, {
  label: string;
  cls: string;
  colBg: string;
  colBorder: string;
  headerBg: string;
  headerText: string;
  cardBg: string;
  dot: string;
}> = {
  brouillon: {
    label:      "Brouillon",
    cls:        "bg-slate-100 text-slate-600",
    colBg:      "bg-slate-50",
    colBorder:  "border-slate-200",
    headerBg:   "bg-slate-100",
    headerText: "text-slate-700",
    cardBg:     "bg-white border-slate-200",
    dot:        "bg-slate-400",
  },
  envoye: {
    label:      "Envoyé",
    cls:        "bg-blue-100 text-blue-700",
    colBg:      "bg-blue-50",
    colBorder:  "border-blue-200",
    headerBg:   "bg-blue-100",
    headerText: "text-blue-800",
    cardBg:     "bg-white border-blue-200",
    dot:        "bg-blue-500",
  },
  signe: {
    label:      "Signé",
    cls:        "bg-green-100 text-green-700",
    colBg:      "bg-green-50",
    colBorder:  "border-green-200",
    headerBg:   "bg-green-100",
    headerText: "text-green-800",
    cardBg:     "bg-white border-green-200",
    dot:        "bg-green-500",
  },
  facture: {
    label:      "Facturé",
    cls:        "bg-orange-100 text-orange-700",
    colBg:      "bg-orange-50",
    colBorder:  "border-orange-200",
    headerBg:   "bg-orange-100",
    headerText: "text-orange-800",
    cardBg:     "bg-white border-orange-200",
    dot:        "bg-orange-500",
  },
  paye: {
    label:      "Payé",
    cls:        "bg-emerald-100 text-emerald-700",
    colBg:      "bg-emerald-50",
    colBorder:  "border-emerald-200",
    headerBg:   "bg-emerald-100",
    headerText: "text-emerald-800",
    cardBg:     "bg-white border-emerald-200",
    dot:        "bg-emerald-500",
  },
};

const PIPELINE_STATUSES = ["brouillon", "envoye", "signe", "facture", "paye"] as const;

/* ── Helpers ────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function isThisMonth(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

/* ── Carte de stat ──────────────────────────────────────── */
function StatCard({
  label, value, icon, accent,
}: {
  label: string; value: string | number; icon: React.ReactNode; accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${accent} shrink-0`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide truncate">{label}</p>
        <p className="text-xl font-bold text-slate-900 mt-0.5 truncate">{value}</p>
      </div>
    </div>
  );
}

/* ── Menu item ──────────────────────────────────────────── */
function MenuItem({
  label, icon, onClick, danger = false,
}: {
  label: string; icon: React.ReactNode;
  onClick: (e: React.MouseEvent) => void; danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
        danger ? "text-red-600 hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ── Menu actions (vue liste) ───────────────────────────── */
function ActionsMenu({
  d, onDelete, onDuplicate,
}: {
  d: Devis; onDelete: (d: Devis) => void; onDuplicate: (d: Devis) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  function action(fn: () => void) {
    return (e: React.MouseEvent) => { e.stopPropagation(); fn(); setOpen(false); };
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        aria-label="Actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-48 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5">
          <MenuItem label="Voir" icon={<Eye className="h-3.5 w-3.5" />}
            onClick={action(() => router.push(`/dashboard/devis/${d.id}`))} />
          <MenuItem label="Modifier" icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={action(() => router.push(`/dashboard/devis/${d.id}/modifier`))} />
          <MenuItem label="Dupliquer" icon={<Copy className="h-3.5 w-3.5" />}
            onClick={action(() => onDuplicate(d))} />
          <MenuItem label="Télécharger PDF" icon={<Download className="h-3.5 w-3.5" />}
            onClick={action(() => window.open(`/print/devis/${d.id}?download=1`, "_blank"))} />
          <div className="my-1 mx-2 border-t border-slate-100" />
          <MenuItem label="Supprimer" icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={action(() => onDelete(d))} danger />
        </div>
      )}
    </div>
  );
}

/* ── Dropdown changement de statut (pipeline) ───────────── */
function StatusDropdown({
  devis,
  onStatusChange,
}: {
  devis: Devis;
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  async function changeStatus(e: React.MouseEvent, newStatus: string) {
    e.stopPropagation();
    if (newStatus === devis.status) { setOpen(false); return; }
    setLoading(true);
    setOpen(false);
    try {
      await onStatusChange(devis.id, newStatus);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        disabled={loading}
        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-300 bg-white px-2 py-1 rounded-md transition-colors disabled:opacity-50"
        title="Changer le statut"
      >
        {loading
          ? <Loader2 className="h-3 w-3 animate-spin" />
          : <><ChevronDown className="h-3 w-3" /> Statut</>
        }
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-40 rounded-xl border border-slate-200 bg-white shadow-lg py-1.5">
          {PIPELINE_STATUSES.map((s) => {
            const cfg = STATUS_CONFIG[s];
            const isCurrent = s === devis.status;
            return (
              <button
                key={s}
                onClick={(e) => changeStatus(e, s)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                  isCurrent
                    ? "bg-slate-50 font-semibold text-slate-700 cursor-default"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span className={`h-2 w-2 rounded-full shrink-0 ${cfg.dot}`} />
                {cfg.label}
                {isCurrent && <span className="ml-auto text-slate-400 text-[10px]">actuel</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Carte pipeline ─────────────────────────────────────── */
function PipelineCard({
  d,
  onStatusChange,
}: {
  d: Devis;
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
}) {
  const router = useRouter();
  const cfg = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.brouillon;

  return (
    <div
      onClick={() => router.push(`/dashboard/devis/${d.id}`)}
      className={`rounded-xl border ${cfg.cardBg} shadow-sm p-3.5 cursor-pointer hover:shadow-md transition-shadow space-y-2.5`}
    >
      {/* Client + actions */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 leading-tight truncate flex-1">
          {d.client?.name ?? "—"}
        </p>
        <StatusDropdown devis={d} onStatusChange={onStatusChange} />
      </div>

      {/* Numéro */}
      <p className="text-xs font-mono text-slate-400">{d.number}</p>

      {/* Montant + date */}
      <div className="flex items-center justify-between pt-0.5 border-t border-slate-100">
        <span className="text-sm font-bold text-slate-800 tabular-nums">
          {fmt(d.totalTTC)}&nbsp;€
        </span>
        <span className="text-xs text-slate-400">
          {new Date(d.createdAt).toLocaleDateString("fr-FR")}
        </span>
      </div>
    </div>
  );
}

/* ── Vue pipeline ───────────────────────────────────────── */
function PipelineView({
  devis,
  onStatusChange,
}: {
  devis: Devis[];
  onStatusChange: (id: string, newStatus: string) => Promise<void>;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-[400px]">
      {PIPELINE_STATUSES.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const cards = devis.filter((d) => d.status === status);
        const total = cards.reduce((s, d) => s + d.totalTTC, 0);

        return (
          <div
            key={status}
            className={`flex-shrink-0 w-64 rounded-xl border ${cfg.colBorder} ${cfg.colBg} flex flex-col`}
          >
            {/* En-tête colonne */}
            <div className={`rounded-t-xl px-3.5 py-3 ${cfg.headerBg} border-b ${cfg.colBorder}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`} />
                  <span className={`text-sm font-semibold ${cfg.headerText}`}>{cfg.label}</span>
                </div>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${cfg.cls}`}>
                  {cards.length}
                </span>
              </div>
              {cards.length > 0 && (
                <p className={`text-xs mt-1 font-medium ${cfg.headerText} opacity-70`}>
                  {fmt(total)}&nbsp;€ TTC
                </p>
              )}
            </div>

            {/* Cartes */}
            <div className="flex flex-col gap-2.5 p-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-340px)]">
              {cards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <p className="text-xs text-slate-400">Aucun devis</p>
                </div>
              ) : (
                cards.map((d) => (
                  <PipelineCard key={d.id} d={d} onStatusChange={onStatusChange} />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Page principale ────────────────────────────────────── */
export default function DevisPage() {
  const router = useRouter();
  const [devis, setDevis]               = useState<Devis[]>([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState("");
  const [view, setView]                 = useState<"liste" | "pipeline">("liste");
  const [toDelete, setToDelete]         = useState<Devis | null>(null);
  const [deleting, setDeleting]         = useState(false);
  const [duplicatingId, setDuplicating] = useState<string | null>(null);
  const [settingsEmpty, setSettingsEmpty] = useState(false);

  const fetchDevis = useCallback(async () => {
    setLoading(true);
    try {
      const [devisRes, settingsRes] = await Promise.all([
        fetch("/api/devis"),
        fetch("/api/settings"),
      ]);
      if (devisRes.ok) setDevis(await devisRes.json());
      if (settingsRes.ok) {
        const s = await settingsRes.json() as { companyName?: string };
        setSettingsEmpty(!s.companyName || s.companyName.trim() === "");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDevis(); }, [fetchDevis]);

  /* Stats */
  const enAttenteCount  = devis.filter((d) => d.status === "envoye").length;
  const signesCount     = devis.filter((d) => d.status === "signe" && isThisMonth(d.signedAt)).length;
  const montantEnCours  = devis.filter((d) => d.status === "brouillon" || d.status === "envoye").reduce((s, d) => s + d.totalTTC, 0);
  const montantSigne    = devis.filter((d) => d.status === "signe" && isThisMonth(d.signedAt)).reduce((s, d) => s + d.totalTTC, 0);

  /* Filtrage (liste uniquement) */
  const filtered = devis.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return d.number.toLowerCase().includes(q) || d.client?.name.toLowerCase().includes(q);
  });

  /* Suppression */
  const handleDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await fetch(`/api/devis/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      await fetchDevis();
    } finally {
      setDeleting(false);
    }
  };

  /* Duplication */
  const handleDuplicate = async (d: Devis) => {
    setDuplicating(d.id);
    try {
      await fetch("/api/devis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: d.clientId,
          validityDays: d.validityDays,
          notes: d.notes,
          lines: d.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceHT: l.unitPriceHT,
            tvaRate: l.tvaRate,
          })),
        }),
      });
      await fetchDevis();
    } finally {
      setDuplicating(null);
    }
  };

  /* Changement de statut (pipeline) */
  const handleStatusChange = async (id: string, newStatus: string) => {
    await fetch(`/api/devis/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    setDevis((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: newStatus } : d))
    );
  };

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="space-y-6">

      {/* Bandeau paramètres incomplets */}
      {settingsEmpty && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
          <span>
            <strong>⚠️ Complétez vos informations dans les{" "}</strong>
            <a href="/dashboard/parametres" className="underline font-semibold hover:text-amber-900">
              Paramètres
            </a>
            {" "}pour personnaliser vos documents.
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mes devis</h1>
          <p className="text-sm text-slate-500 mt-1">{devis.length} devis au total</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle vue */}
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-white shadow-sm">
            <button
              onClick={() => setView("liste")}
              title="Vue liste"
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                view === "liste"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">Liste</span>
            </button>
            <button
              onClick={() => setView("pipeline")}
              title="Vue pipeline"
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors ${
                view === "pipeline"
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
            >
              <Columns className="h-4 w-4" />
              <span className="hidden sm:inline">Pipeline</span>
            </button>
          </div>

          <Link
            href="/dashboard/devis/nouveau"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nouveau devis
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Devis en attente"
          value={enAttenteCount}
          icon={<Clock className="h-4 w-4 text-blue-600" />}
          accent="bg-blue-50"
        />
        <StatCard
          label="Signés ce mois"
          value={signesCount}
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
          accent="bg-green-50"
        />
        <StatCard
          label="Montant en cours"
          value={`${fmt(montantEnCours)} €`}
          icon={<TrendingUp className="h-4 w-4 text-orange-600" />}
          accent="bg-orange-50"
        />
        <StatCard
          label="Montant signé"
          value={`${fmt(montantSigne)} €`}
          icon={<Banknote className="h-4 w-4 text-emerald-600" />}
          accent="bg-emerald-50"
        />
      </div>

      {/* Vue pipeline */}
      {view === "pipeline" && (
        loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <PipelineView devis={devis} onStatusChange={handleStatusChange} />
        )
      )}

      {/* Vue liste */}
      {view === "liste" && (
        <>
          {/* Recherche */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher par client ou numéro…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          {/* Tableau */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                  <FileText className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600">
                  {search ? "Aucun résultat pour cette recherche" : "Aucun devis pour l'instant"}
                </p>
                {!search && (
                  <p className="text-xs text-slate-400 mt-1">
                    Cliquez sur «&nbsp;Nouveau devis&nbsp;» pour commencer
                  </p>
                )}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Numéro</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Montant TTC</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                    <th className="px-4 py-3 w-10" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => {
                    const status = STATUS_CONFIG[d.status] ?? STATUS_CONFIG.brouillon;
                    const isDuplicating = duplicatingId === d.id;
                    return (
                      <tr
                        key={d.id}
                        onClick={() => router.push(`/dashboard/devis/${d.id}`)}
                        className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3.5 font-mono font-semibold text-slate-800 text-xs">
                          {d.number}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-800">
                          {d.client?.name ?? "—"}
                        </td>
                        <td className="px-4 py-3.5 text-slate-500">
                          {new Date(d.createdAt).toLocaleDateString("fr-FR")}
                        </td>
                        <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                          {fmt(d.totalTTC)}&nbsp;€
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${status.cls}`}>
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 py-3.5 text-right">
                          {isDuplicating ? (
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400 inline" />
                          ) : (
                            <ActionsMenu
                              d={d}
                              onDelete={setToDelete}
                              onDuplicate={handleDuplicate}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Confirmation suppression */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => { if (!open) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer le devis</AlertDialogTitle>
            <AlertDialogDescription>
              Êtes-vous sûr de vouloir supprimer le devis{" "}
              <span className="font-semibold text-slate-900">{toDelete?.number}</span> ?
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
