"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Receipt, Search, Download,
  TrendingUp, Clock, CheckCircle, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Facture {
  id: string;
  number: string;
  status: string;
  totalTTC: number;
  createdAt: string;
  paidAt: string | null;
  client: { name: string };
}

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string) => new Date(d).toLocaleDateString("fr-FR");

function getDisplayStatus(f: Facture): { label: string; cls: string } {
  if (f.status === "payee") return { label: "Payée", cls: "bg-green-100 text-green-700" };
  const daysSince = (Date.now() - new Date(f.createdAt).getTime()) / 86_400_000;
  if (daysSince > 30) return { label: "En retard", cls: "bg-red-100 text-red-600" };
  return { label: "Émise", cls: "bg-blue-100 text-blue-700" };
}

export default function FacturesPage() {
  const [factures, setFactures] = useState<Facture[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");

  useEffect(() => {
    fetch("/api/factures")
      .then((r) => r.json())
      .then(setFactures)
      .finally(() => setLoading(false));
  }, []);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const emises    = factures.filter((f) => f.status === "emise");
  const payesMois = factures.filter(
    (f) => f.status === "payee" && f.paidAt && new Date(f.paidAt) >= startOfMonth
  );
  const impayesTTC = emises.reduce((s, f) => s + f.totalTTC, 0);
  const caPayeMois = payesMois.reduce((s, f) => s + f.totalTTC, 0);

  const stats = [
    {
      title: "Factures émises",
      value: String(emises.length),
      description: "En attente de paiement",
      icon: Clock,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
    },
    {
      title: "Payées ce mois",
      value: String(payesMois.length),
      description: now.toLocaleString("fr-FR", { month: "long", year: "numeric" }),
      icon: CheckCircle,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
    },
    {
      title: "CA encaissé",
      value: `${fmt(caPayeMois)} €`,
      description: "TTC ce mois",
      icon: TrendingUp,
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
    },
    {
      title: "Impayés",
      value: `${fmt(impayesTTC)} €`,
      description: "Total TTC à encaisser",
      icon: AlertCircle,
      iconBg: "bg-red-50",
      iconColor: "text-red-600",
    },
  ];

  const filtered = factures.filter(
    (f) =>
      f.client.name.toLowerCase().includes(search.toLowerCase()) ||
      f.number.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mes factures</h1>
          <p className="text-sm text-slate-500 mt-1">{factures.length} facture{factures.length !== 1 ? "s" : ""} au total</p>
        </div>
        <button
          disabled
          title="Export disponible prochainement"
          className="inline-flex items-center gap-2 border border-slate-200 text-slate-400 text-sm font-medium px-4 py-2 rounded-lg cursor-not-allowed"
        >
          <Download className="h-4 w-4" />
          Exporter
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title} className="border border-slate-200 shadow-sm">
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium text-slate-500">{stat.title}</CardTitle>
                </div>
                <div className={`rounded-lg p-2 ${stat.iconBg}`}>
                  <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-slate-900 tabular-nums">{stat.value}</p>
                <p className="text-xs text-slate-500 mt-1">{stat.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Recherche + tableau */}
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une facture ou un client…"
              className="w-full pl-9 pr-4 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
              Chargement…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="rounded-full bg-slate-100 p-4 mb-3">
                <Receipt className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600">
                {search ? "Aucune facture ne correspond à votre recherche" : "Aucune facture pour l'instant"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {!search && "Transformez un devis signé en facture pour commencer"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Numéro</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Client</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Montant TTC</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const s = getDisplayStatus(f);
                    return (
                      <tr key={f.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3.5">
                          <Link href={`/dashboard/factures/${f.id}`} className="font-mono text-blue-600 hover:underline font-semibold">
                            {f.number}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5">
                          <Link href={`/dashboard/factures/${f.id}`} className="text-slate-800 hover:text-slate-900 font-medium">
                            {f.client.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5 text-slate-500">{fmtDate(f.createdAt)}</td>
                        <td className="px-4 py-3.5 text-right font-semibold text-slate-900 tabular-nums">
                          {fmt(f.totalTTC)}&nbsp;€
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full ${s.cls}`}>
                            {s.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
