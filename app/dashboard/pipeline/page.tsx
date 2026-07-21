"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Loader2, User, ChevronDown, Check, Trash2, Save, TrendingUp, Kanban as KanbanIcon } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface Opportunity {
  id: string;
  title: string;
  amount: number | null;
  probability: number;
  stage: string;
  expectedCloseAt: string | null;
  notes: string | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
}

interface ClientOption { id: string; name: string; }

const STAGES: { value: string; label: string }[] = [
  { value: "nouveau", label: "Nouveau" },
  { value: "qualification", label: "Qualification" },
  { value: "proposition", label: "Proposition" },
  { value: "negociation", label: "Négociation" },
  { value: "gagne", label: "Gagné" },
  { value: "perdu", label: "Perdu" },
];

const fmt = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function PipelinePage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [clients, setClients]             = useState<ClientOption[]>([]);
  const [loading, setLoading]             = useState(true);
  const [dialogOpen, setDialogOpen]       = useState(false);
  const [editing, setEditing]             = useState<Opportunity | null>(null);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [openStageMenu, setOpenStageMenu] = useState<string | null>(null);

  const [fTitle, setFTitle]         = useState("");
  const [fClientId, setFClientId]   = useState("");
  const [fAmount, setFAmount]       = useState("");
  const [fProbability, setFProbability] = useState("50");
  const [fCloseDate, setFCloseDate] = useState("");
  const [fNotes, setFNotes]         = useState("");

  const load = () => {
    setLoading(true);
    fetch("/api/opportunities")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setOpportunities(data as Opportunity[]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClients((data as ClientOption[]).map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const byStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const s of STAGES) map.set(s.value, []);
    for (const o of opportunities) map.get(o.stage)?.push(o);
    return map;
  }, [opportunities]);

  const totalPondere = useMemo(() => {
    return opportunities
      .filter((o) => o.stage !== "gagne" && o.stage !== "perdu")
      .reduce((sum, o) => sum + ((o.amount ?? 0) * o.probability) / 100, 0);
  }, [opportunities]);

  const resetForm = () => {
    setFTitle(""); setFClientId(""); setFAmount(""); setFProbability("50"); setFCloseDate(""); setFNotes("");
    setError(null);
  };

  const openCreate = () => {
    resetForm();
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (o: Opportunity) => {
    resetForm();
    setEditing(o);
    setFTitle(o.title);
    setFClientId(o.clientId ?? "");
    setFAmount(o.amount != null ? String(o.amount) : "");
    setFProbability(String(o.probability));
    setFCloseDate(o.expectedCloseAt ? o.expectedCloseAt.slice(0, 10) : "");
    setFNotes(o.notes ?? "");
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!fTitle.trim()) { setError("Le titre est obligatoire"); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: fTitle,
        clientId: fClientId || null,
        amount: fAmount ? Number(fAmount) : null,
        probability: Number(fProbability),
        expectedCloseAt: fCloseDate || null,
        notes: fNotes || null,
      };
      const url = editing ? `/api/opportunities/${editing.id}` : "/api/opportunities";
      const method = editing ? "PATCH" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (r.ok) {
        setOpportunities((prev) => editing ? prev.map((o) => (o.id === data.id ? data : o)) : [data, ...prev]);
        setDialogOpen(false);
      } else {
        setError(data.error ?? "Erreur lors de l'enregistrement");
      }
    } catch {
      setError("Erreur réseau");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const r = await fetch(`/api/opportunities/${editing.id}`, { method: "DELETE" });
      if (r.ok) {
        setOpportunities((prev) => prev.filter((o) => o.id !== editing.id));
        setDialogOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const changeStage = async (id: string, stage: string) => {
    setOpenStageMenu(null);
    setOpportunities((prev) => prev.map((o) => (o.id === id ? { ...o, stage } : o)));
    await fetch(`/api/opportunities/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    }).catch(() => {});
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Pipeline commercial</h1>
          <p className="text-sm text-slate-500 mt-1">
            Vos opportunités commerciales, indépendamment des devis déjà envoyés.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg px-3 py-2">
            <TrendingUp className="h-4 w-4 text-blue-500" />
            <span className="font-semibold text-slate-900 tabular-nums">{fmt(totalPondere)} €</span>
            <span className="text-xs text-slate-400">pondéré</span>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" /> Nouvelle opportunité
          </button>
        </div>
      </div>

      {opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-xl border border-slate-200">
          <KanbanIcon className="h-8 w-8 text-slate-300 mb-3" />
          <p className="text-sm font-medium text-slate-600">Aucune opportunité pour l&apos;instant</p>
          <p className="text-xs text-slate-400 mt-1">Créez-en une pour commencer à suivre votre pipeline commercial.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 items-start">
          {STAGES.map((s) => {
            const items = byStage.get(s.value) ?? [];
            const stageTotal = items.reduce((sum, o) => sum + (o.amount ?? 0), 0);
            return (
              <div key={s.value} className="bg-slate-50 rounded-xl border border-slate-200 p-2.5 min-h-[120px]">
                <div className="flex items-center justify-between px-1 mb-2">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{s.label}</span>
                  <span className="text-xs text-slate-400">{items.length}</span>
                </div>
                {stageTotal > 0 && (
                  <p className="text-[11px] text-slate-400 px-1 mb-2 tabular-nums">{fmt(stageTotal)} €</p>
                )}
                <div className="space-y-2">
                  {items.map((o) => (
                    <div key={o.id} className="bg-white rounded-lg border border-slate-200 p-2.5 shadow-sm">
                      <button onClick={() => openEdit(o)} className="block w-full text-left">
                        <p className="text-xs font-semibold text-slate-800 truncate">{o.title}</p>
                        {o.client && (
                          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                            <User className="h-2.5 w-2.5" /> {o.client.name}
                          </p>
                        )}
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-xs font-semibold text-slate-700 tabular-nums">
                            {o.amount != null ? `${fmt(o.amount)} €` : "—"}
                          </span>
                          <span className="text-[10px] font-medium text-blue-600">{o.probability}%</span>
                        </div>
                      </button>
                      <div className="relative mt-1.5">
                        <button
                          onClick={() => setOpenStageMenu(openStageMenu === o.id ? null : o.id)}
                          className="w-full flex items-center justify-center gap-1 text-[10px] font-medium text-slate-500 hover:bg-slate-50 border border-slate-100 rounded py-1"
                        >
                          Déplacer <ChevronDown className="h-2.5 w-2.5" />
                        </button>
                        {openStageMenu === o.id && (
                          <div className="absolute left-0 right-0 z-20 mt-1 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                            {STAGES.filter((st) => st.value !== o.stage).map((st) => (
                              <button
                                key={st.value}
                                onClick={() => changeStage(o.id, st.value)}
                                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium hover:bg-slate-50 text-slate-700"
                              >
                                <Check className="h-3 w-3 text-slate-300" /> {st.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Dialog opportunité ───────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier l'opportunité" : "Nouvelle opportunité"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Titre</Label>
              <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Ex : Rénovation salle de bain — M. Martin" />
            </div>
            <div className="space-y-1.5">
              <Label>Client (optionnel)</Label>
              <Select value={fClientId} onChange={(e) => setFClientId(e.target.value)}>
                <option value="">— Aucun —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Montant estimé (€)</Label>
                <Input type="number" min="0" value={fAmount} onChange={(e) => setFAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Probabilité (%)</Label>
                <Input type="number" min="0" max="100" value={fProbability} onChange={(e) => setFProbability(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date de clôture estimée</Label>
              <Input type="date" value={fCloseDate} onChange={(e) => setFCloseDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea rows={3} value={fNotes} onChange={(e) => setFNotes(e.target.value)} />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editing ? (
              <button onClick={remove} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> Supprimer
              </button>
            ) : <span />}
            <Button onClick={submit} disabled={saving} className="inline-flex items-center gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
