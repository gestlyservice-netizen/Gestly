"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Loader2, Printer } from "lucide-react";

/* ── Types ─────────────────────────────────────────────── */
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
  client: { name: string; email: string | null; phone: string | null; address: string | null };
  lines:  Line[];
  devis:  { lines: Line[] } | null;
}

interface Settings {
  companyName:       string;
  formeJuridique:    string | null;
  siret:             string | null;
  tvaIntracom:       string | null;
  adresseRue:        string | null;
  codePostal:        string | null;
  ville:             string | null;
  telephone:         string | null;
  emailPro:          string | null;
  logoUrl:           string | null;
  couleurPrincipale: string;
  piedDePage:        string | null;
  penalitesRetard:   string | null;
}

/* ── Helpers ─────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

/* ── Page ───────────────────────────────────────────────── */
export default function PrintFacturePage() {
  const { id }        = useParams<{ id: string }>();
  const searchParams  = useSearchParams();
  const autoDownload  = searchParams.get("download") === "1";

  const [facture,     setFacture]     = useState<Facture | null>(null);
  const [settings,    setSettings]    = useState<Settings | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [downloading, setDownloading] = useState(false);
  const docRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/factures/${id}`).then((r) => r.json()),
      fetch("/api/settings").then((r) => r.json()),
    ])
      .then(([factureData, settingsData]) => {
        setFacture(factureData as Facture);
        setSettings(settingsData as Settings);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && facture && autoDownload && docRef.current) {
      const el = docRef.current;
      setDownloading(true);
      const timer = setTimeout(async () => {
        try {
          const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
            import("html2canvas"),
            import("jspdf"),
          ]);
          const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
          const imgData = canvas.toDataURL("image/jpeg", 0.95);
          const pdf = new jsPDF({ unit: "px", format: [canvas.width / 2, canvas.height / 2] });
          pdf.addImage(imgData, "JPEG", 0, 0, canvas.width / 2, canvas.height / 2);
          pdf.save(`facture-${facture!.number}.pdf`);
        } finally {
          setDownloading(false);
          window.close();
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [loading, facture, autoDownload]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!facture) {
    return (
      <div className="flex items-center justify-center h-screen text-slate-500">
        Facture introuvable.
      </div>
    );
  }

  const couleur    = settings?.couleurPrincipale ?? "#2563EB";
  const lines      = (facture.lines ?? []).length > 0 ? facture.lines : (facture.devis?.lines ?? []);
  const isPaid     = facture.status === "payee";
  const adresseLigne2 = [settings?.codePostal, settings?.ville].filter(Boolean).join(" ");
  const penalites  = settings?.penalitesRetard
    ?? "En cas de retard de paiement, une pénalité égale à 3 fois le taux d'intérêt légal sera exigée conformément à l'article L.441-6 du Code de commerce, ainsi qu'une indemnité forfaitaire de 40 euros pour frais de recouvrement (art. D.441-5).";

  return (
    <>
      {!autoDownload && (
        <div className="print:hidden fixed top-0 left-0 right-0 z-10 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <button onClick={() => window.close()} className="text-sm text-slate-600 hover:text-slate-900">
            ← Fermer
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Printer className="h-4 w-4" />
            Télécharger / Imprimer PDF
          </button>
        </div>
      )}

      {downloading && (
        <div className="fixed inset-0 z-50 bg-white/80 flex flex-col items-center justify-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          <p className="text-sm text-slate-600">Génération du PDF…</p>
        </div>
      )}

      <div className={`${autoDownload ? "" : "print:pt-0 pt-16"} bg-slate-100 min-h-screen print:bg-white`}>
        <div ref={docRef} className="max-w-[794px] mx-auto bg-white print:shadow-none shadow-xl my-8 print:my-0 print:max-w-full">
          <div className="p-12 print:p-8">

            {/* ── En-tête ──────────────────────────────────── */}
            <div className="flex justify-between items-start mb-10">

              {/* Gauche : entreprise */}
              <div className="flex items-start gap-3 max-w-[280px]">
                {settings?.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={settings.logoUrl}
                    alt="Logo"
                    className="h-14 w-auto object-contain shrink-0"
                  />
                )}
                <div>
                  <div className="text-xl font-bold leading-tight" style={{ color: couleur }}>
                    {settings?.companyName || "Mon Entreprise"}
                  </div>
                  {settings?.formeJuridique && (
                    <div className="text-xs text-slate-500 mt-0.5">{settings.formeJuridique}</div>
                  )}
                  {settings?.adresseRue && (
                    <div className="text-xs text-slate-500 mt-1">{settings.adresseRue}</div>
                  )}
                  {adresseLigne2 && (
                    <div className="text-xs text-slate-500">{adresseLigne2}</div>
                  )}
                  {settings?.telephone && (
                    <div className="text-xs text-slate-500 mt-1">{settings.telephone}</div>
                  )}
                  {settings?.emailPro && (
                    <div className="text-xs text-slate-500">{settings.emailPro}</div>
                  )}
                  {settings?.siret && (
                    <div className="text-xs text-slate-400 mt-1">SIRET : {settings.siret}</div>
                  )}
                  {settings?.tvaIntracom && (
                    <div className="text-xs text-slate-400">TVA : {settings.tvaIntracom}</div>
                  )}
                </div>
              </div>

              {/* Droite : titre document */}
              <div className="text-right">
                <h1 className="text-3xl font-bold text-slate-900 tracking-tight">FACTURE</h1>
                <p className="text-lg font-mono font-semibold mt-1" style={{ color: couleur }}>
                  {facture.number}
                </p>
                <p className="text-sm text-slate-500 mt-1">Date : {fmtDate(facture.createdAt)}</p>
                {facture.dueDate && (
                  <p className="text-sm text-slate-500">Échéance : {fmtDate(facture.dueDate)}</p>
                )}
                {isPaid && facture.paidAt && (
                  <p className="text-sm font-semibold text-green-700 mt-1">
                    Acquittée le {fmtDate(facture.paidAt)}
                  </p>
                )}
              </div>
            </div>

            {/* ── Client ───────────────────────────────────── */}
            <div className="flex justify-end mb-10">
              <div className="bg-slate-50 rounded-xl px-6 py-4 min-w-[240px]">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Destinataire</p>
                <p className="font-bold text-slate-900">{facture.client.name}</p>
                {facture.client.address && (
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{facture.client.address}</p>
                )}
                {facture.client.email && (
                  <p className="text-sm text-slate-500 mt-1">{facture.client.email}</p>
                )}
                {facture.client.phone && (
                  <p className="text-sm text-slate-500">{facture.client.phone}</p>
                )}
              </div>
            </div>

            {/* ── Tableau des lignes ───────────────────────── */}
            <table className="w-full mb-8 text-sm">
              <thead>
                <tr style={{ backgroundColor: couleur }} className="text-white">
                  <th className="text-left px-4 py-3 rounded-tl-lg font-semibold">Description</th>
                  <th className="text-right px-4 py-3 font-semibold">Qté</th>
                  <th className="text-right px-4 py-3 font-semibold">Prix HT</th>
                  <th className="text-right px-4 py-3 font-semibold">TVA</th>
                  <th className="text-right px-4 py-3 rounded-tr-lg font-semibold">Total HT</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={line.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                    <td className="px-4 py-3 text-slate-800">{line.description}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{line.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{fmt(line.unitPriceHT)} €</td>
                    <td className="px-4 py-3 text-right text-slate-500">{line.tvaRate} %</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmt(line.totalHT)} €</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* ── Totaux ───────────────────────────────────── */}
            <div className="flex justify-end mb-8">
              <div className="w-72">
                <div className="flex justify-between py-2 text-sm text-slate-600 border-b border-slate-100">
                  <span>Total HT</span>
                  <span className="font-medium text-slate-800">{fmt(facture.totalHT)} €</span>
                </div>
                <div className="flex justify-between py-2 text-sm text-slate-600 border-b border-slate-100">
                  <span>Total TVA</span>
                  <span className="font-medium text-slate-800">{fmt(facture.totalTVA)} €</span>
                </div>
                <div
                  className="flex justify-between py-3 text-white rounded-lg px-4 mt-2"
                  style={{ backgroundColor: couleur }}
                >
                  <span className="font-bold text-base">Total TTC</span>
                  <span className="font-bold text-xl">{fmt(facture.totalTTC)} €</span>
                </div>
              </div>
            </div>

            {/* ── Notes ────────────────────────────────────── */}
            {facture.notes && (
              <div className="border-t border-slate-100 pt-6 mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Notes</p>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{facture.notes}</p>
              </div>
            )}

            {/* ── Pied de page + mentions légales ─────────── */}
            <div className="border-t border-slate-200 pt-5 mt-6 space-y-3">
              {settings?.piedDePage && (
                <p className="text-xs text-slate-500 text-center">{settings.piedDePage}</p>
              )}
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">
                  Mentions légales
                </p>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Règlement à réception de facture. {penalites}
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
