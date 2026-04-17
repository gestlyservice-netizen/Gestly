"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Building2, Palette, Hash, FileText,
  Upload, Loader2, CheckCircle, AlertCircle,
  Save, X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

/* ── Zod schema ─────────────────────────────────────────── */
const schema = z.object({
  companyName:           z.string().min(1, "Le nom de l'entreprise est requis"),
  formeJuridique:        z.string().optional(),
  siret:                 z.union([
    z.string().length(14, "Le SIRET doit contenir exactement 14 chiffres").regex(/^\d{14}$/, "Chiffres uniquement"),
    z.literal(""),
  ]).optional(),
  tvaIntracom:           z.union([
    z.string().regex(/^FR[0-9A-Z]{2}\d{9}$/, "Format attendu : FR + 2 car. + 9 chiffres (ex: FR12345678901)"),
    z.literal(""),
  ]).optional(),
  adresseRue:            z.string().optional(),
  codePostal:            z.union([
    z.string().regex(/^\d{5}$/, "Code postal invalide"),
    z.literal(""),
  ]).optional(),
  ville:                 z.string().optional(),
  telephone:             z.string().optional(),
  emailPro:              z.union([
    z.string().email("Email invalide"),
    z.literal(""),
  ]).optional(),
  siteWeb:               z.union([
    z.string().url("URL invalide (ex: https://monsite.fr)"),
    z.literal(""),
  ]).optional(),
  couleurPrincipale:     z.string().default("#2563EB"),
  piedDePage:            z.string().optional(),
  prefixeDevis:          z.string().min(1, "Requis"),
  prefixeFacture:        z.string().min(1, "Requis"),
  prochainNumeroDevis:   z.coerce.number().int().min(1, "Minimum 1"),
  prochainNumeroFacture: z.coerce.number().int().min(1, "Minimum 1"),
  conditionsPaiement:    z.string().optional(),
  penalitesRetard:       z.string().optional(),
  reservePropriete:      z.boolean().default(false),
});

type FormValues = z.infer<typeof schema>;

/* ── Defaults ───────────────────────────────────────────── */
const FORM_DEFAULTS: FormValues = {
  companyName:           "",
  formeJuridique:        "",
  siret:                 "",
  tvaIntracom:           "",
  adresseRue:            "",
  codePostal:            "",
  ville:                 "",
  telephone:             "",
  emailPro:              "",
  siteWeb:               "",
  couleurPrincipale:     "#2563EB",
  piedDePage:            "",
  prefixeDevis:          "DEV-",
  prefixeFacture:        "FAC-",
  prochainNumeroDevis:   1,
  prochainNumeroFacture: 1,
  conditionsPaiement:    "Règlement à réception de facture.",
  penalitesRetard:       "En cas de retard de paiement, une pénalité égale à 3 fois le taux d'intérêt légal sera appliquée conformément à l'article L.441-6 du Code de commerce, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. D.441-5).",
  reservePropriete:      false,
};

/* ── Field helpers ──────────────────────────────────────── */
function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
      <AlertCircle className="h-3 w-3 shrink-0" /> {msg}
    </p>
  );
}

function Field({
  label, required, children, error, hint,
}: {
  label: string; required?: boolean; children: React.ReactNode;
  error?: string; hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-slate-700">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-slate-400">{hint}</p>}
      <FieldError msg={error} />
    </div>
  );
}

/* ── Section header ─────────────────────────────────────── */
function SectionHeader({
  icon, title, subtitle,
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
}) {
  return (
    <div className="flex items-start gap-3 mb-6">
      <div className="p-2.5 rounded-xl bg-slate-100 shrink-0">{icon}</div>
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────── */
export default function ParametresPage() {
  const [loading,       setLoading]       = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUrl,       setLogoUrl]       = useState<string>("");
  const [toast,         setToast]         = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    register, handleSubmit, reset, watch, setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: FORM_DEFAULTS,
  });

  const couleur        = watch("couleurPrincipale");
  const reserveProp    = watch("reservePropriete");

  /* Chargement des settings existants */
  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        if (!r.ok) return;
        const data = await r.json() as Partial<FormValues> & { logoUrl?: string };
        reset({
          companyName:           data.companyName           ?? FORM_DEFAULTS.companyName,
          formeJuridique:        data.formeJuridique        ?? "",
          siret:                 data.siret                 ?? "",
          tvaIntracom:           data.tvaIntracom           ?? "",
          adresseRue:            data.adresseRue            ?? "",
          codePostal:            data.codePostal            ?? "",
          ville:                 data.ville                 ?? "",
          telephone:             data.telephone             ?? "",
          emailPro:              data.emailPro              ?? "",
          siteWeb:               data.siteWeb               ?? "",
          couleurPrincipale:     data.couleurPrincipale     ?? "#2563EB",
          piedDePage:            data.piedDePage            ?? "",
          prefixeDevis:          data.prefixeDevis          ?? "DEV-",
          prefixeFacture:        data.prefixeFacture        ?? "FAC-",
          prochainNumeroDevis:   data.prochainNumeroDevis   ?? 1,
          prochainNumeroFacture: data.prochainNumeroFacture ?? 1,
          conditionsPaiement:    data.conditionsPaiement    ?? FORM_DEFAULTS.conditionsPaiement,
          penalitesRetard:       data.penalitesRetard       ?? FORM_DEFAULTS.penalitesRetard,
          reservePropriete:      data.reservePropriete      ?? false,
        });
        if (data.logoUrl) setLogoUrl(data.logoUrl);
      })
      .finally(() => setLoading(false));
  }, [reset]);

  /* Toast auto-dismiss */
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  /* Upload logo */
  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/settings/logo", { method: "POST", body: fd });
      const data = await r.json() as { url?: string; error?: string };
      if (!r.ok || !data.url) {
        setToast({ type: "error", msg: data.error ?? "Échec de l'upload du logo" });
        return;
      }
      setLogoUrl(data.url);
      setValue("couleurPrincipale", watch("couleurPrincipale")); // keep form dirty marker
      setToast({ type: "success", msg: "Logo uploadé avec succès" });
    } catch {
      setToast({ type: "error", msg: "Erreur réseau lors de l'upload" });
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /* Suppression logo */
  function handleRemoveLogo() {
    setLogoUrl("");
  }

  /* Sauvegarde */
  async function onSubmit(values: FormValues) {
    setSaving(true);
    try {
      const r = await fetch("/api/settings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...values, logoUrl }),
      });
      if (r.ok) {
        setToast({ type: "success", msg: "Paramètres sauvegardés !" });
      } else {
        const data = await r.json() as { error?: string };
        setToast({ type: "error", msg: data.error ?? "Erreur lors de la sauvegarde" });
      }
    } catch {
      setToast({ type: "error", msg: "Erreur réseau" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-16">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configurez votre entreprise, vos documents et vos préférences.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium border ${
          toast.type === "success"
            ? "bg-green-50 border-green-200 text-green-800"
            : "bg-red-50 border-red-200 text-red-700"
        }`}>
          {toast.type === "success"
            ? <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
            : <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
          }
          {toast.type === "success" ? "✅ " : ""}{toast.msg}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">

        {/* ── SECTION 1 : Informations entreprise ────────── */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <SectionHeader
              icon={<Building2 className="h-5 w-5 text-slate-600" />}
              title="Informations de l'entreprise"
              subtitle="Ces informations apparaissent sur vos devis et factures."
            />
          </CardHeader>
          <CardContent className="space-y-4">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Field label="Nom de l'entreprise" required error={errors.companyName?.message}>
                  <Input {...register("companyName")} placeholder="Mon Entreprise" />
                </Field>
              </div>

              <Field label="Forme juridique" error={errors.formeJuridique?.message}>
                <div className="relative">
                  <Select {...register("formeJuridique")} className="pr-8">
                    <option value="">— Sélectionner —</option>
                    <option value="Auto-entrepreneur">Auto-entrepreneur</option>
                    <option value="SARL">SARL</option>
                    <option value="SAS">SAS</option>
                    <option value="EURL">EURL</option>
                    <option value="EI">EI</option>
                    <option value="Artisan">Artisan</option>
                  </Select>
                  <svg className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                </div>
              </Field>

              <Field label="SIRET" hint="14 chiffres" error={errors.siret?.message}>
                <Input {...register("siret")} placeholder="12345678901234" maxLength={14} />
              </Field>

              <Field label="N° TVA intracommunautaire" hint="Optionnel — ex : FR12345678901" error={errors.tvaIntracom?.message}>
                <Input {...register("tvaIntracom")} placeholder="FR12345678901" />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Adresse (rue)" error={errors.adresseRue?.message}>
                  <Input {...register("adresseRue")} placeholder="12 rue de la Paix" />
                </Field>
              </div>

              <Field label="Code postal" error={errors.codePostal?.message}>
                <Input {...register("codePostal")} placeholder="75001" maxLength={5} />
              </Field>

              <Field label="Ville" error={errors.ville?.message}>
                <Input {...register("ville")} placeholder="Paris" />
              </Field>

              <Field label="Téléphone" error={errors.telephone?.message}>
                <Input {...register("telephone")} placeholder="01 23 45 67 89" type="tel" />
              </Field>

              <Field label="Email professionnel" error={errors.emailPro?.message}>
                <Input {...register("emailPro")} placeholder="contact@monentreprise.fr" type="email" />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Site web" hint="Optionnel" error={errors.siteWeb?.message}>
                  <Input {...register("siteWeb")} placeholder="https://monentreprise.fr" type="url" />
                </Field>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ── SECTION 2 : Apparence ───────────────────────── */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <SectionHeader
              icon={<Palette className="h-5 w-5 text-slate-600" />}
              title="Apparence des documents"
              subtitle="Personnalisez le rendu de vos devis et factures PDF."
            />
          </CardHeader>
          <CardContent className="space-y-5">

            {/* Logo */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-700">Logo de l&apos;entreprise</Label>
              <div className="flex items-center gap-4 flex-wrap">
                {logoUrl ? (
                  <div className="relative group h-16 w-32 rounded-lg border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logoUrl} alt="Logo" className="max-h-14 max-w-[120px] object-contain" />
                    <button
                      type="button"
                      onClick={handleRemoveLogo}
                      className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-white border border-slate-200 shadow-sm text-slate-500 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="h-16 w-32 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-400">
                    Aucun logo
                  </div>
                )}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingLogo}
                    className="inline-flex items-center gap-2 text-sm font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {uploadingLogo
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Upload className="h-4 w-4" />
                    }
                    {uploadingLogo ? "Upload…" : "Choisir un fichier"}
                  </button>
                  <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP ou SVG — max 2 Mo</p>
                </div>
              </div>
            </div>

            {/* Couleur principale */}
            <Field label="Couleur principale" hint="Utilisée dans l'en-tête et les totaux de vos documents">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={couleur}
                  onChange={(e) => setValue("couleurPrincipale", e.target.value, { shouldDirty: true })}
                  className="h-8 w-12 rounded-md border border-slate-200 cursor-pointer p-0.5 bg-white"
                />
                <Input
                  {...register("couleurPrincipale")}
                  className="w-32 font-mono text-xs uppercase"
                  maxLength={7}
                  placeholder="#2563EB"
                  onChange={(e) => {
                    const val = e.target.value;
                    setValue("couleurPrincipale", val, { shouldDirty: true });
                  }}
                  value={couleur}
                />
                <div
                  className="h-8 w-8 rounded-lg border border-slate-200 shrink-0"
                  style={{ backgroundColor: couleur }}
                />
              </div>
            </Field>

            {/* Pied de page */}
            <Field label="Pied de page personnalisé" hint="Affiché en bas de chaque document PDF">
              <Textarea
                {...register("piedDePage")}
                placeholder="Votre entreprise — SIRET 12345678901234 — RCS Paris B 123 456 789"
                rows={3}
              />
            </Field>

          </CardContent>
        </Card>

        {/* ── SECTION 3 : Numérotation ────────────────────── */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <SectionHeader
              icon={<Hash className="h-5 w-5 text-slate-600" />}
              title="Numérotation"
              subtitle="Définissez le format et le prochain numéro de vos documents."
            />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

              <Field label="Préfixe devis" hint='ex : "DEV-2026-"' error={errors.prefixeDevis?.message}>
                <Input {...register("prefixeDevis")} placeholder="DEV-" />
              </Field>

              <Field label="Prochain n° devis" error={errors.prochainNumeroDevis?.message}>
                <Input
                  {...register("prochainNumeroDevis")}
                  type="number"
                  min={1}
                  placeholder="1"
                />
              </Field>

              <Field label="Préfixe facture" hint='ex : "FAC-2026-"' error={errors.prefixeFacture?.message}>
                <Input {...register("prefixeFacture")} placeholder="FAC-" />
              </Field>

              <Field label="Prochain n° facture" error={errors.prochainNumeroFacture?.message}>
                <Input
                  {...register("prochainNumeroFacture")}
                  type="number"
                  min={1}
                  placeholder="1"
                />
              </Field>

            </div>

            <div className="mt-4 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <p className="text-xs text-blue-700">
                <strong>Aperçu :</strong>{" "}
                {watch("prefixeDevis") || "DEV-"}001 &nbsp;/&nbsp; {watch("prefixeFacture") || "FAC-"}001
              </p>
            </div>
          </CardContent>
        </Card>

        {/* ── SECTION 4 : Mentions légales ────────────────── */}
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <SectionHeader
              icon={<FileText className="h-5 w-5 text-slate-600" />}
              title="Mentions légales"
              subtitle="Textes affichés en bas de vos devis et factures."
            />
          </CardHeader>
          <CardContent className="space-y-5">

            <Field label="Conditions de paiement par défaut">
              <Textarea
                {...register("conditionsPaiement")}
                placeholder="Règlement à réception de facture."
                rows={3}
              />
            </Field>

            <Field label="Pénalités de retard" hint="Texte légal obligatoire selon l'art. L.441-6 du Code de commerce">
              <Textarea
                {...register("penalitesRetard")}
                rows={4}
              />
            </Field>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
              <Switch
                id="reservePropriete"
                checked={reserveProp}
                onCheckedChange={(v) => setValue("reservePropriete", v, { shouldDirty: true })}
              />
              <div className="space-y-0.5">
                <Label htmlFor="reservePropriete" className="text-sm font-medium text-slate-800 cursor-pointer">
                  Clause de réserve de propriété
                </Label>
                <p className="text-xs text-slate-500">
                  Ajoute automatiquement une clause de réserve de propriété sur vos factures.
                </p>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ── Bouton sauvegarder ──────────────────────────── */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Save className="h-4 w-4" />
            }
            {saving ? "Sauvegarde…" : "Sauvegarder les paramètres"}
          </Button>
        </div>

      </form>
    </div>
  );
}
