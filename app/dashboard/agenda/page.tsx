"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft, ChevronRight, Plus, Loader2, MapPin, User, Trash2, Save, X, CalendarDays,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

interface EventItem {
  id: string;
  title: string;
  description: string | null;
  address: string | null;
  startAt: string;
  endAt: string | null;
  clientId: string | null;
  client: { id: string; name: string } | null;
}

interface ClientOption { id: string; name: string; }

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AgendaPage() {
  const [cursor, setCursor]     = useState(() => startOfMonth(new Date()));
  const [events, setEvents]     = useState<EventItem[]>([]);
  const [clients, setClients]   = useState<ClientOption[]>([]);
  const [loading, setLoading]   = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]   = useState<EventItem | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [fTitle, setFTitle]           = useState("");
  const [fDescription, setFDescription] = useState("");
  const [fAddress, setFAddress]       = useState("");
  const [fStart, setFStart]           = useState("");
  const [fEnd, setFEnd]               = useState("");
  const [fClientId, setFClientId]     = useState("");

  const monthLabel = `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const rangeStart = useMemo(() => {
    const first = startOfMonth(cursor);
    const dow = (first.getDay() + 6) % 7; // lundi = 0
    return new Date(first.getFullYear(), first.getMonth(), first.getDate() - dow);
  }, [cursor]);

  const days = useMemo(() => {
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(rangeStart);
      d.setDate(rangeStart.getDate() + i);
      return d;
    });
  }, [rangeStart]);

  useEffect(() => {
    setLoading(true);
    const from = days[0].toISOString();
    const to = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate(), 23, 59, 59).toISOString();
    fetch(`/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setEvents(data as EventItem[]))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor]);

  useEffect(() => {
    fetch("/api/clients")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setClients((data as ClientOption[]).map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => {});
  }, []);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const ev of events) {
      const key = new Date(ev.startAt).toDateString();
      map.set(key, [...(map.get(key) ?? []), ev]);
    }
    return map;
  }, [events]);

  const resetForm = () => {
    setFTitle(""); setFDescription(""); setFAddress(""); setFStart(""); setFEnd(""); setFClientId("");
    setError(null);
  };

  const openCreate = (day: Date) => {
    resetForm();
    setEditing(null);
    const start = new Date(day);
    start.setHours(9, 0, 0, 0);
    setFStart(toLocalInputValue(start));
    setDialogOpen(true);
  };

  const openEdit = (ev: EventItem) => {
    resetForm();
    setEditing(ev);
    setFTitle(ev.title);
    setFDescription(ev.description ?? "");
    setFAddress(ev.address ?? "");
    setFStart(toLocalInputValue(new Date(ev.startAt)));
    setFEnd(ev.endAt ? toLocalInputValue(new Date(ev.endAt)) : "");
    setFClientId(ev.clientId ?? "");
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!fTitle.trim() || !fStart) {
      setError("Titre et date de début sont obligatoires");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: fTitle,
        description: fDescription || null,
        address: fAddress || null,
        startAt: new Date(fStart).toISOString(),
        endAt: fEnd ? new Date(fEnd).toISOString() : null,
        clientId: fClientId || null,
      };
      const url = editing ? `/api/events/${editing.id}` : "/api/events";
      const method = editing ? "PUT" : "POST";
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await r.json();
      if (r.ok) {
        setEvents((prev) => editing
          ? prev.map((e) => (e.id === data.id ? data : e))
          : [...prev, data]);
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
      const r = await fetch(`/api/events/${editing.id}`, { method: "DELETE" });
      if (r.ok) {
        setEvents((prev) => prev.filter((e) => e.id !== editing.id));
        setDialogOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agenda</h1>
          <p className="text-sm text-slate-500 mt-1">Vos rendez-vous et interventions</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setCursor((c) => addMonths(c, -1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-slate-800 w-36 text-center">{monthLabel}</span>
          <button onClick={() => setCursor((c) => addMonths(c, 1))} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-2 rounded-lg"
          >
            Aujourd&apos;hui
          </button>
          <button
            onClick={() => openCreate(new Date())}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" /> Nouveau
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50">
            {WEEKDAYS.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day, i) => {
              const inMonth = day.getMonth() === cursor.getMonth();
              const isToday = sameDay(day, new Date());
              const dayEvents = eventsByDay.get(day.toDateString()) ?? [];
              return (
                <div
                  key={i}
                  onClick={() => openCreate(day)}
                  className={`min-h-[100px] border-b border-r border-slate-100 p-1.5 cursor-pointer hover:bg-slate-50 transition-colors ${
                    inMonth ? "bg-white" : "bg-slate-50/50"
                  }`}
                >
                  <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    isToday ? "bg-blue-600 text-white" : inMonth ? "text-slate-700" : "text-slate-300"
                  }`}>
                    {day.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={ev.id}
                        onClick={(e) => { e.stopPropagation(); openEdit(ev); }}
                        className="block w-full text-left text-[11px] font-medium bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded truncate hover:bg-blue-100"
                      >
                        {new Date(ev.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} {ev.title}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <p className="text-[10px] text-slate-400 pl-1">+{dayEvents.length - 3} autre(s)</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {events.length === 0 && !loading && (
        <div className="flex flex-col items-center justify-center py-6 text-center text-slate-400 text-sm">
          <CalendarDays className="h-6 w-6 mb-2" />
          Aucun événement ce mois-ci. Cliquez sur un jour pour en créer un.
        </div>
      )}

      {/* ── Dialog événement ─────────────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier l'événement" : "Nouvel événement"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Titre</Label>
              <Input value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Ex : Intervention chez M. Dupont" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Début</Label>
                <Input type="datetime-local" value={fStart} onChange={(e) => setFStart(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Fin (optionnel)</Label>
                <Input type="datetime-local" value={fEnd} onChange={(e) => setFEnd(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> Client (optionnel)</Label>
              <Select value={fClientId} onChange={(e) => setFClientId(e.target.value)}>
                <option value="">— Aucun —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Adresse (optionnel)</Label>
              <Input value={fAddress} onChange={(e) => setFAddress(e.target.value)} placeholder="Adresse de l'intervention" />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optionnel)</Label>
              <Textarea rows={3} value={fDescription} onChange={(e) => setFDescription(e.target.value)} />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            {editing ? (
              <button
                onClick={remove}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Supprimer
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button
                onClick={() => setDialogOpen(false)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 px-3 py-2"
              >
                <X className="h-4 w-4" /> Annuler
              </button>
              <Button onClick={submit} disabled={saving} className="inline-flex items-center gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
