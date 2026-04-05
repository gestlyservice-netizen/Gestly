"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Plus, Trash2, Loader2, ChevronLeft, Search } from "lucide-react";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";
const selectCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none cursor-pointer";

const lineSchema = z.object({
  description:  z.string().min(1, "Requis"),
  quantity:     z.number().min(0.01, "Invalide"),
  unitPriceHT:  z.number().min(0, "Invalide"),
  tvaRate:      z.number(),
});

const devisSchema = z.object({
  clientId:     z.string().min(1, "Sélectionnez un client"),
  validityDays: z.number().int().min(1),
  notes:        z.string().optional(),
  lines:        z.array(lineSchema).min(1, "Ajoutez au moins une ligne"),
});

type DevisForm = z.infer<typeof devisSchema>;
interface Client { id: string; name: string; email: string | null; phone: string | null }

const TVA_OPTIONS = [
  { label: "0 %",   value: 0    },
  { label: "5,5 %", value: 5.5  },
  { label: "10 %",  value: 10   },
  { label: "20 %",  value: 20   },
];

export default function ModifierDevisPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [clients, setClients]             = useState<Client[]>([]);
  const [loadingData, setLoadingData]     = useState(true);
  const [saving, setSaving]               = useState(false);
  const [apiError, setApiError]           = useState<string | null>(null);

  /* ── Recherche client ── */
  const [clientSearch, setClientSearch]   = useState("");
  const [showDropdown, setShowDropdown]   = useState(false);
  const searchRef                         = useRef<HTMLDivElement>(null);

  const filteredClients = clientSearch.length === 0
    ? clients
    : clients.filter((c) =>
        c.name.toLowerCase().includes(clientSearch.toLowerCase())
      );

  /* ── Formulaire ── */
  const {
    register, control, handleSubmit, setValue, reset,
    formState: { errors },
  } = useForm<DevisForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(devisSchema) as any,
    defaultValues: {
      clientId: "", validityDays: 30, notes: "",
      lines: [{ description: "", quantity: 1, unitPriceHT: 0, tvaRate: 20 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });

  const lineTotals = (watchedLines ?? []).map((l) =>
    (Number(l?.quantity) || 0) * (Number(l?.unitPriceHT) || 0)
  );
  const totalHT  = lineTotals.reduce((a, b) => a + b, 0);
  const totalTVA = (watchedLines ?? []).reduce(
    (acc, l, i) => acc + lineTotals[i] * (Number(l?.tvaRate) || 0) / 100, 0
  );
  const totalTTC = totalHT + totalTVA;

  const fmt = (n: number) =>
    n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ── Chargement données ── */
  useEffect(() => {
    Promise.all([
      fetch("/api/clients").then((r) => r.json()),
      fetch(`/api/devis/${id}`).then((r) => r.json()),
    ]).then(([clientsData, devisData]) => {
      setClients(clientsData);

      // Pré-remplir le client search avec le nom existant
      const existingClient = clientsData.find((c: Client) => c.id === devisData.clientId);
      if (existingClient) setClientSearch(existingClient.name);

      reset({
        clientId:     devisData.clientId,
        validityDays: devisData.validityDays,
        notes:        devisData.notes ?? "",
        lines: devisData.lines.map((l: {
          description: string; quantity: number; unitPriceHT: number; tvaRate: number;
        }) => ({
          description: l.description,
          quantity:    l.quantity,
          unitPriceHT: l.unitPriceHT,
          tvaRate:     l.tvaRate,
        })),
      });
    }).finally(() => setLoadingData(false));
  }, [id, reset]);

  /* ── Fermer dropdown au clic extérieur ── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectClient = (c: Client) => {
    setValue("clientId", c.id);
    setClientSearch(c.name);
    setShowDropdown(false);
  };

  /* ── Soumettre ── */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const submitDevis = async (data: any) => {
    setSaving(true);
    setApiError(null);
    try {
      const res = await fetch(`/api/devis/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        router.push(`/dashboard/devis/${id}`);
      } else {
        const json = await res.json().catch(() => ({}));
        setApiError(json.error ?? `Erreur ${res.status}`);
      }
    } catch {
      setApiError("Erreur réseau, réessayez.");
    } finally {
      setSaving(false);
    }
  };

  if (loadingData) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href={`/dashboard/devis/${id}`}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Modifier le devis</h1>
          <p className="text-sm text-slate-500">Les modifications remplacent le contenu existant</p>
        </div>
      </div>

      {apiError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {apiError}
        </div>
      )}

      <div className="space-y-5">
        {/* ── Client ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">Client</h2>

          <div ref={searchRef} className="relative">
            {/* Champ de recherche */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                className={inputCls + " pl-9"}
                placeholder="Rechercher un client par nom..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setValue("clientId", "");
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                autoComplete="off"
              />
            </div>

            {/* Dropdown suggestions */}
            {showDropdown && (
              <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                {filteredClients.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-400">Aucun client trouvé</div>
                ) : (
                  filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onMouseDown={() => selectClient(c)}
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 hover:text-blue-700 transition-colors"
                    >
                      <span className="font-medium">{c.name}</span>
                      {c.email && (
                        <span className="text-slate-400 text-xs ml-2">{c.email}</span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Champ caché pour react-hook-form */}
          <input type="hidden" {...register("clientId")} />
          {errors.clientId && (
            <p className="text-xs text-red-500 mt-1">{errors.clientId.message}</p>
          )}
        </div>

        {/* ── Lignes du devis ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
            Lignes du devis
          </h2>

          <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-2 mb-2 px-1">
            <span className="text-xs font-medium text-slate-500">Description</span>
            <span className="text-xs font-medium text-slate-500">Qté</span>
            <span className="text-xs font-medium text-slate-500">Prix HT (€)</span>
            <span className="text-xs font-medium text-slate-500">TVA</span>
            <span className="text-xs font-medium text-slate-500 text-right">Total HT</span>
            <span />
          </div>

          <div className="space-y-2">
            {fields.map((field, index) => {
              const lineTotal = lineTotals[index] ?? 0;
              return (
                <div
                  key={field.id}
                  className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-2 items-center p-2 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <input
                      className={inputCls}
                      placeholder="Description de la prestation"
                      {...register(`lines.${index}.description`)}
                    />
                    {errors.lines?.[index]?.description && (
                      <p className="text-xs text-red-500 mt-0.5">
                        {errors.lines[index]?.description?.message}
                      </p>
                    )}
                  </div>
                  <input
                    type="number" step="0.01" min="0"
                    className={inputCls} placeholder="1"
                    {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                  />
                  <input
                    type="number" step="0.01" min="0"
                    className={inputCls} placeholder="0,00"
                    {...register(`lines.${index}.unitPriceHT`, { valueAsNumber: true })}
                  />
                  <select
                    className={selectCls + " w-24"}
                    {...register(`lines.${index}.tvaRate`, { valueAsNumber: true })}
                  >
                    {TVA_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <div className="text-right font-medium text-slate-800 text-sm w-24">
                    {fmt(lineTotal)} €
                  </div>
                  <button
                    type="button"
                    onClick={() => fields.length > 1 && remove(index)}
                    disabled={fields.length <= 1}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => append({ description: "", quantity: 1, unitPriceHT: 0, tvaRate: 20 })}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 border border-dashed border-blue-300 hover:border-blue-400 px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Ajouter une ligne
          </button>
        </div>

        {/* ── Totaux ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total HT</span>
                <span className="font-medium text-slate-900">{fmt(totalHT)} €</span>
              </div>
              <div className="flex justify-between text-sm text-slate-600">
                <span>Total TVA</span>
                <span className="font-medium text-slate-900">{fmt(totalTVA)} €</span>
              </div>
              <div className="border-t border-slate-200 pt-2 flex justify-between">
                <span className="font-bold text-slate-900">Total TTC</span>
                <span className="text-xl font-bold text-blue-600">{fmt(totalTTC)} €</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Options ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Options</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Durée de validité (jours)</label>
              <input
                type="number" min="1"
                className={inputCls}
                {...register("validityDays", { valueAsNumber: true })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">
              Notes / Observations <span className="text-slate-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              rows={3}
              className={inputCls + " resize-none"}
              placeholder="Conditions particulières, informations complémentaires..."
              {...register("notes")}
            />
          </div>
        </div>

        {/* ── Boutons ── */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-6">
          <Link
            href={`/dashboard/devis/${id}`}
            className="text-center text-sm font-medium text-slate-600 border border-slate-300 hover:border-slate-400 px-6 py-2.5 rounded-lg transition-colors"
          >
            Annuler
          </Link>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSubmit(submitDevis)()}
            className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer les modifications
          </button>
        </div>
      </div>
    </div>
  );
}
