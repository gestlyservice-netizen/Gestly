"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Save, CheckCircle, AlertCircle, Bell, Mail, MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

interface RelanceSettings {
  enabled: boolean;
  delaiJ1: number;
  delaiJ2: number;
  delaiJ3: number;
  canalEmail: boolean;
  canalSms: boolean;
  messageJ1: string | null;
  messageJ2: string | null;
  messageJ3: string | null;
}

const DEFAULTS: RelanceSettings = {
  enabled: false, delaiJ1: 3, delaiJ2: 10, delaiJ3: 21,
  canalEmail: true, canalSms: false,
  messageJ1: null, messageJ2: null, messageJ3: null,
};

export default function RelancesSettingsPage() {
  const [settings, setSettings] = useState<RelanceSettings>(DEFAULTS);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [toast, setToast]       = useState<{ type: "success" | "error"; msg: string } | null>(null);

  useEffect(() => {
    fetch("/api/settings/relances")
      .then((r) => r.json())
      .then((data) => setSettings({ ...DEFAULTS, ...data }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/settings/relances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (r.ok) {
        setToast({ type: "success", msg: "Paramètres de relance sauvegardés" });
      } else {
        const data = await r.json();
        setToast({ type: "error", msg: data.error ?? "Erreur lors de la sauvegarde" });
      }
    } catch {
      setToast({ type: "error", msg: "Erreur réseau" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      <div className="flex items-center gap-3">
        <Link href="/dashboard/parametres" className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Relances automatiques</h1>
          <p className="text-sm text-slate-500 mt-1">
            Gestly relance vos clients pour vous en cas de facture impayée après échéance.
          </p>
        </div>
      </div>

      {toast && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${
          toast.type === "success" ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {toast.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0 text-green-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />}
          {toast.msg}
        </div>
      )}

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-slate-100 shrink-0">
                <Bell className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Activer les relances automatiques</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Une facture non payée après son échéance sera relancée automatiquement, en 3 niveaux progressifs.
                </p>
              </div>
            </div>
            <Switch checked={settings.enabled} onCheckedChange={(v) => setSettings((s) => ({ ...s, enabled: v }))} />
          </div>
        </CardHeader>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">Canaux</h2>
          <p className="text-xs text-slate-500 mt-0.5">Chaque canal activé est utilisé indépendamment à chaque niveau de relance.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <Mail className="h-4 w-4 text-slate-400" /> Email
            </div>
            <Switch checked={settings.canalEmail} onCheckedChange={(v) => setSettings((s) => ({ ...s, canalEmail: v }))} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <MessageSquare className="h-4 w-4 text-slate-400" /> SMS (OVH)
            </div>
            <Switch checked={settings.canalSms} onCheckedChange={(v) => setSettings((s) => ({ ...s, canalSms: v }))} />
          </div>
          <p className="text-xs text-slate-400">
            Si le solde de crédits SMS est insuffisant au moment de l&apos;envoi, la relance SMS est annulée pour cette
            fois (aucun blocage du reste du système) et une alerte est enregistrée.
          </p>
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm">
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-900">Délais et messages</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Nombre de jours après l&apos;échéance avant chaque niveau. Variables disponibles dans les messages :{" "}
            <code className="text-[11px] bg-slate-100 px-1 py-0.5 rounded">{"{clientName} {companyName} {number} {amount} {daysLate}"}</code>
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {([1, 2, 3] as const).map((n) => (
            <div key={n} className="space-y-2 pb-5 border-b border-slate-100 last:border-0 last:pb-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wide w-20 shrink-0">Niveau {n}</span>
                <Label className="text-xs text-slate-500 shrink-0">Après</Label>
                <Input
                  type="number"
                  min={1}
                  className="w-20"
                  value={settings[`delaiJ${n}` as "delaiJ1" | "delaiJ2" | "delaiJ3"]}
                  onChange={(e) => setSettings((s) => ({ ...s, [`delaiJ${n}`]: Number(e.target.value) }))}
                />
                <span className="text-xs text-slate-500">jours de retard</span>
              </div>
              <Textarea
                rows={3}
                placeholder={`Message par défaut niveau ${n} (laisser vide pour utiliser le modèle standard)`}
                value={settings[`messageJ${n}` as "messageJ1" | "messageJ2" | "messageJ3"] ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, [`messageJ${n}`]: e.target.value }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? "Sauvegarde…" : "Sauvegarder"}
        </Button>
      </div>

    </div>
  );
}
