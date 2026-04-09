import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Clock, FileCheck, TrendingUp, AlertCircle,
  ArrowUpRight, Plus, FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/* ── Helpers ────────────────────────────────────────────── */
const fmt = (n: number | null) =>
  (n ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  brouillon: { label: "Brouillon", cls: "bg-slate-100 text-slate-600" },
  envoye:    { label: "Envoyé",    cls: "bg-blue-100 text-blue-700" },
  signe:     { label: "Signé",     cls: "bg-green-100 text-green-700" },
  facture:   { label: "Facturé",   cls: "bg-orange-100 text-orange-700" },
  paye:      { label: "Payé",      cls: "bg-emerald-100 text-emerald-700" },
};

const FACTURE_LABEL: Record<string, { label: string; cls: string }> = {
  emise:  { label: "Émise",  cls: "bg-blue-100 text-blue-700" },
  payee:  { label: "Payée",  cls: "bg-green-100 text-green-700" },
  retard: { label: "Retard", cls: "bg-red-100 text-red-600" },
};

/* ── Page (Server Component) ────────────────────────────── */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    enAttenteCount,
    signesCount,
    montantSigneAgg,
    impayesAgg,
    devisRecents,
    facturesRecentes,
  ] = await Promise.all([
    prisma.devis.count({
      where: { userId: user.id, status: "envoye" },
    }),
    prisma.devis.count({
      where: { userId: user.id, status: "signe", signedAt: { gte: startOfMonth } },
    }),
    prisma.devis.aggregate({
      where: { userId: user.id, status: "signe", signedAt: { gte: startOfMonth } },
      _sum: { totalTTC: true },
    }),
    prisma.facture.aggregate({
      where: { userId: user.id, paidAt: null },
      _sum: { totalTTC: true },
    }),
    prisma.devis.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
    prisma.facture.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { client: { select: { name: true } } },
    }),
  ]);

  const stats = [
    {
      title: "Devis en attente",
      value: String(enAttenteCount),
      description: "En cours de validation",
      icon: Clock,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      badge: "À traiter",
    },
    {
      title: "Devis signés ce mois",
      value: String(signesCount),
      description: "Signés en " + now.toLocaleString("fr-FR", { month: "long" }),
      icon: FileCheck,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
      badge: "Ce mois",
    },
    {
      title: "CA signé ce mois",
      value: `${fmt(montantSigneAgg._sum.totalTTC)} €`,
      description: "TTC devis signés",
      icon: TrendingUp,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      badge: "TTC",
    },
    {
      title: "Impayés",
      value: `${fmt(impayesAgg._sum.totalTTC)} €`,
      description: "Factures non réglées",
      icon: AlertCircle,
      iconBg: "bg-red-50",
      iconColor: "text-red-600",
      badge: "À relancer",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Vue d&apos;ensemble de votre activité
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card
              key={stat.title}
              className="relative overflow-hidden border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200"
            >
              <CardHeader className="flex flex-row items-start justify-between pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium text-slate-500">
                    {stat.title}
                  </CardTitle>
                  <span className="inline-block text-xs border border-slate-200 text-slate-500 rounded px-1.5 py-0.5">
                    {stat.badge}
                  </span>
                </div>
                <div className={`rounded-lg p-2 ${stat.iconBg}`}>
                  <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900 tabular-nums">
                      {stat.value}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">{stat.description}</p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-300" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Derniers devis + Dernières factures */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Derniers devis */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Derniers devis
            </CardTitle>
            <Link
              href="/dashboard/devis/nouveau"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Nouveau
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {devisRecents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <div className="rounded-full bg-slate-100 p-4 mb-3">
                  <FileText className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600">Aucun devis pour l&apos;instant</p>
                <p className="text-xs text-slate-400 mt-1">Vos devis récents apparaîtront ici</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {devisRecents.map((d) => {
                  const s = STATUS_LABEL[d.status] ?? { label: d.status, cls: "bg-slate-100 text-slate-600" };
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/dashboard/devis/${d.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {d.client.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{d.number}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>
                            {s.label}
                          </span>
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">
                            {fmt(d.totalTTC)}&nbsp;€
                          </span>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {devisRecents.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-50">
                <Link href="/dashboard/devis" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                  Voir tous les devis →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Dernières factures */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Dernières factures
            </CardTitle>
            <Link
              href="/dashboard/factures"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              Voir tout
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {facturesRecentes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center px-4">
                <div className="rounded-full bg-slate-100 p-4 mb-3">
                  <TrendingUp className="h-6 w-6 text-slate-400" />
                </div>
                <p className="text-sm font-medium text-slate-600">Aucune facture pour l&apos;instant</p>
                <p className="text-xs text-slate-400 mt-1">Vos factures récentes apparaîtront ici</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {facturesRecentes.map((f) => {
                  const paid = f.paidAt !== null;
                  const s = paid ? FACTURE_LABEL.payee : FACTURE_LABEL.emise;
                  return (
                    <li key={f.id}>
                      <div className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {f.client.name}
                          </p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{f.number}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.cls}`}>
                            {s.label}
                          </span>
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">
                            {fmt(f.totalTTC)}&nbsp;€
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {facturesRecentes.length > 0 && (
              <div className="px-5 py-3 border-t border-slate-50">
                <Link href="/dashboard/factures" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                  Voir toutes les factures →
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
