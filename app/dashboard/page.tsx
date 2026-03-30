import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Clock,
  FileCheck,
  TrendingUp,
  AlertCircle,
  ArrowUpRight,
} from "lucide-react";

const stats = [
  {
    title: "Devis en attente",
    value: "0",
    description: "En cours de validation",
    icon: Clock,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
    badge: { label: "À traiter", variant: "outline" as const },
  },
  {
    title: "Devis signés ce mois",
    value: "0",
    description: "Sur 30 derniers jours",
    icon: FileCheck,
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
    badge: { label: "Ce mois", variant: "outline" as const },
  },
  {
    title: "CA facturé ce mois",
    value: "0 €",
    description: "Hors taxes",
    icon: TrendingUp,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
    badge: { label: "HT", variant: "outline" as const },
  },
  {
    title: "Impayés",
    value: "0 €",
    description: "Factures en retard",
    icon: AlertCircle,
    iconBg: "bg-red-50",
    iconColor: "text-red-600",
    badge: { label: "À relancer", variant: "outline" as const },
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          Vue d&apos;ensemble de votre activité
        </p>
      </div>

      {/* Stats grid */}
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
                  <Badge variant={stat.badge.variant} className="text-xs">
                    {stat.badge.label}
                  </Badge>
                </div>
                <div className={`rounded-lg p-2 ${stat.iconBg}`}>
                  <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-3xl font-bold text-slate-900">
                      {stat.value}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {stat.description}
                    </p>
                  </div>
                  <ArrowUpRight className="h-4 w-4 text-slate-300" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900">
              Derniers devis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="rounded-full bg-slate-100 p-4 mb-3">
                <Clock className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600">Aucun devis pour l&apos;instant</p>
              <p className="text-xs text-slate-400 mt-1">
                Vos devis récents apparaîtront ici
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900">
              Dernières factures
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <div className="rounded-full bg-slate-100 p-4 mb-3">
                <TrendingUp className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600">Aucune facture pour l&apos;instant</p>
              <p className="text-xs text-slate-400 mt-1">
                Vos factures récentes apparaîtront ici
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
