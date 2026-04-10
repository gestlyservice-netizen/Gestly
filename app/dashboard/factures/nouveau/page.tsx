"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { Plus, Trash2, Loader2, ChevronLeft, UserPlus, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/* ── Styles partagés ─────────────────────────────────────── */
const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";
const selectCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition appearance-none cursor-pointer";

/* ── Schémas Zod ──────────────────────────────────────────── */
const lineSchema = z.object({
  description: z.string().min(1, "Requis"),
  quantity:    z.number().min(0.01, "Invalide"),
  unitPriceHT: z.number().min(0, "Invalide"),
  tvaRate:     z.number(),
});

const factureSchema = z.object({
  clientId: z.string().min(1, "Sélectionnez un client"),
  dueDate:  z.string().optional(),
  notes:    z.string().optional(),
  lines:    z.array(lineSchema).min(1, "Ajoutez au moins une prestation"),
});

type FactureForm = z.infer<typeof factureSchema>;

const clientFormSchema = z.object({
  name:    z.string().min(1, "Le nom est obligatoire"),
  email:   z.string().email("Email invalide").optional().or(z.literal("")),
  phone:   z.string().optional(),
  address: z.string().optional(),
});
type ClientFormData = z.infer<typeof clientFormSchema>;

interface Client { id: string; name: string; email: string | null; phone: string | null }

const TVA_OPTIONS = [
  { label: "0 %",   value: 0   },
  { label: "5,5 %", value: 5.5 },
  { label: "10 %",  value: 10  },
  { label: "20 %",  value: 20  },
];

/* ── Helpers ─────────────────────────────────────────────── */
const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function todayIso() {
  return new Date().toISOString().split("T")[0];
}
function in30DaysIso() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().split("T")[0];
}

/* ── Page ────────────────────────────────────────────────── */
export default function NouvelleFacturePage() {
  const router = useRouter();

  const [clients, setClients]           = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [saving, setSaving]             = useState(false);
  const [apiError, setApiError]         = useState<string | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [addingClient, setAddingClient] = useState(false);

  /* Recherche client */
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const filteredClients = clientSearch.length === 0
    ? clients
    : clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()));

  /* ── Formulaire facture ─────────────────────────────────── */
  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FactureForm>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(factureSchema) as any,
    defaultValues: {
      clientId: "",
      dueDate:  in30DaysIso(),
      notes:    "",
      lines:    [{ description: "", quantity: 1, unitPriceHT: 0, tvaRate: 20 }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watchedLines = useWatch({ control, name: "lines" });

  /* ── Formulaire ajout client rapide ─────────────────────── */
  const {
    register: regClient,
    handleSubmit: handleClientSubmit,
    reset: resetClient,
    formState: { errors: clientErrors },
  } = useForm<ClientFormData>({ resolver: zodResolver(clientFormSchema) });

  /* ── Calculs temps réel ──────────────────────────────────── */
  const lineTotals = (watchedLines ?? []).map((l) =>
    (Number(l?.quantity) || 0) * (Number(l?.unitPriceHT) || 0)
  );
  const totalHT  = lineTotals.reduce((a, b) => a + b, 0);
  const totalTVA = (watchedLines ?? []).reduce(
    (acc, l, i) => acc + lineTotals[i] * (Number(l?.tvaRate) || 0) / 100, 0
  );
  const totalTTC = totalHT + totalTVA;

  /* ── Charger les clients ─────────────────────────────────── */
  const fetchClients = async () => {
    setLoadingClients(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) setClients(await res.json());
    } finally {
      setLoadingClients(false);
    }
  };

  useEffect(() => { fetchClients(); }, []);

  /* ── Fermer dropdown au clic extérieur ─────────────────── */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node))
        setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectClient = (c: Client) => {
    setValue("clientId", c.id);
    setClientSearch(c.name);
    setShowDropdown(false);
  };

  /* ── Soumettre ───────────────────────────────────────────── */
  const submitFacture = async (data: FactureForm) => {
    setSaving(true);
    setApiError(null);
    try {
      const res = await fetch("/api/factures", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      });
      if (res.ok) {
        const facture = await res.json();
        router.push(`/dashboard/factures/${facture.id}`);
      } else {
        const json = await res.json().catch(() => ({}));
        setApiError((json as { error?: string }).error ?? `Erreur ${res.status}`);
      }
    } catch {
      setApiError("Erreur réseau, réessayez.");
    } finally {
      setSaving(false);
    }
  };

  /* ── Ajouter client rapide ───────────────────────────────── */
  const onAddClient = async (data: ClientFormData) => {
    setAddingClient(true);
    try {
      const res = await fetch("/api/clients", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(data),
      });
      if (res.ok) {
        const newClient = await res.json() as Client;
        await fetchClients();
        selectClient(newClient);
        setAddClientOpen(false);
        resetClient();
      }
    } finally {
      setAddingClient(false);
    }
  };

  /* ── Render ──────────────────────────────────────────────── */
  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* En-tête */}
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/factures"
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Nouvelle facture</h1>
          <p className="text-sm text-slate-500">Le numéro sera généré automatiquement (FAC-{new Date().getFullYear()}-XXX)</p>
        </div>
      </div>

      {/* Erreur API */}
      {apiError && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          {apiError}
        </div>
      )}

      <div className="space-y-5">

        {/* ── Section 1 : Client ────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
            Client
          </h2>
          <div className="flex items-start gap-3">
            <div className="flex-1">
              {loadingClients ? (
                <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
              ) : (
                <div ref={searchRef} className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                    <input
                      className={inputCls + " pl-9"}
                      placeholder={
                        clients.length === 0
                          ? "Aucun client — ajoutez-en un →"
                          : "Rechercher un client par nom..."
                      }
                      value={clientSearch}
                      disabled={clients.length === 0}
                      onChange={(e) => {
                        setClientSearch(e.target.value);
                        setValue("clientId", "");
                        setShowDropdown(true);
                      }}
                      onFocus={() => setShowDropdown(true)}
                      autoComplete="off"
                    />
                  </div>
                  {showDropdown && clients.length > 0 && (
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
                  <input type="hidden" {...register("clientId")} />
                </div>
              )}
              {errors.clientId && (
                <p className="text-xs text-red-500 mt-1">{errors.clientId.message}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => { resetClient(); setAddClientOpen(true); }}
              title="Ajouter un nouveau client"
              className="h-10 w-10 flex items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors shrink-0"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ── Section 2 : Informations de la facture ────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Informations
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Date d&apos;émission</label>
              <input
                type="date"
                className={inputCls}
                defaultValue={todayIso()}
                disabled
              />
              <p className="text-xs text-slate-400">Automatiquement la date du jour</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Date d&apos;échéance{" "}
                <span className="text-slate-400 font-normal">(optionnel)</span>
              </label>
              <input
                type="date"
                className={inputCls}
                {...register("dueDate")}
              />
            </div>
          </div>
        </div>

        {/* ── Section 3 : Prestations ───────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-4">
            Prestations
          </h2>

          <div className="hidden sm:grid grid-cols-[2fr_1fr_1fr_auto_auto_auto] gap-2 mb-2 px-1">
            <span className="text-xs font-medium text-slate-500">Désignation</span>
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
                    type="number"
                    step="0.01"
                    min="0"
                    className={inputCls}
                    placeholder="1"
                    {...register(`lines.${index}.quantity`, { valueAsNumber: true })}
                  />

                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={inputCls}
                    placeholder="0,00"
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
                    title="Supprimer la prestation"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          {errors.lines && typeof errors.lines.message === "string" && (
            <p className="text-xs text-red-500 mt-2">{errors.lines.message}</p>
          )}

          <button
            type="button"
            onClick={() => append({ description: "", quantity: 1, unitPriceHT: 0, tvaRate: 20 })}
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700 border border-dashed border-blue-300 hover:border-blue-400 px-4 py-2 rounded-lg transition-colors"
          >
            <Plus className="h-4 w-4" />
            Ajouter une prestation
          </button>
        </div>

        {/* ── Section 4 : Totaux ────────────────────────────── */}
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

        {/* ── Section 5 : Notes & mentions légales ─────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            Notes &amp; mentions légales
          </h2>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-slate-700">
              Notes / Observations{" "}
              <span className="text-slate-400 font-normal">(optionnel)</span>
            </label>
            <textarea
              rows={3}
              className={inputCls + " resize-none"}
              placeholder="Conditions de paiement, informations complémentaires..."
              {...register("notes")}
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Mentions légales appliquées automatiquement
            </p>
            <p className="text-xs text-slate-400 leading-relaxed">
              Règlement à réception de facture. En cas de retard de paiement, une pénalité égale
              à 3 fois le taux d&apos;intérêt légal sera exigée conformément à l&apos;article L.441-6
              du Code de commerce, ainsi qu&apos;une indemnité forfaitaire de 40 euros pour frais de
              recouvrement (art. D.441-5).
            </p>
          </div>
        </div>

        {/* ── Boutons de sauvegarde ─────────────────────────── */}
        <div className="flex flex-col sm:flex-row justify-end gap-3 pb-6">
          <Link
            href="/dashboard/factures"
            className="text-center text-sm font-medium text-slate-600 border border-slate-300 hover:border-slate-400 px-6 py-2.5 rounded-lg transition-colors"
          >
            Annuler
          </Link>
          <button
            type="button"
            disabled={saving}
            onClick={() => handleSubmit(submitFacture)()}
            className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors shadow-sm disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Créer la facture
          </button>
        </div>

      </div>

      {/* ── Modal : Ajouter un client rapide ─────────────────── */}
      <Dialog open={addClientOpen} onOpenChange={setAddClientOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un client</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                className={inputCls}
                placeholder="Ex : Martin Dupont"
                {...regClient("name")}
              />
              {clientErrors.name && (
                <p className="text-xs text-red-500">{clientErrors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                className={inputCls}
                placeholder="Ex : martin@email.fr"
                {...regClient("email")}
              />
              {clientErrors.email && (
                <p className="text-xs text-red-500">{clientErrors.email.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Téléphone</label>
              <input
                className={inputCls}
                placeholder="Ex : 06 12 34 56 78"
                {...regClient("phone")}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">Adresse</label>
              <textarea
                rows={2}
                className={inputCls + " resize-none"}
                placeholder="Ex : 12 rue de la Paix, 75001 Paris"
                {...regClient("address")}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAddClientOpen(false)}
                className="text-sm font-medium text-slate-600 border border-slate-300 px-4 py-2 rounded-lg hover:border-slate-400 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={addingClient}
                onClick={() => handleClientSubmit(onAddClient)()}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-60"
              >
                {addingClient && <Loader2 className="h-4 w-4 animate-spin" />}
                Ajouter
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
