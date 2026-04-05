"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Pencil, Trash2, Users, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition";

/* ── Schema de validation ─────────────────────────────── */
const clientSchema = z.object({
  name: z.string().min(1, "Le nom est obligatoire"),
  email: z.string().email("Email invalide").optional().or(z.literal("")),
  phone: z.string().optional(),
  address: z.string().optional(),
});
type ClientForm = z.infer<typeof clientSchema>;

/* ── Type client ─────────────────────────────────────── */
interface Client {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
}

/* ── Composant principal ─────────────────────────────── */
export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClientForm>({ resolver: zodResolver(clientSchema) });

  /* Charger les clients */
  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) setClients(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClients(); }, []);

  /* Ouvrir modal ajout */
  const openAdd = () => {
    setEditingClient(null);
    setApiError(null);
    reset({ name: "", email: "", phone: "", address: "" });
    setModalOpen(true);
  };

  /* Ouvrir modal modification */
  const openEdit = (client: Client) => {
    setApiError(null);
    setEditingClient(client);
    reset({
      name: client.name,
      email: client.email ?? "",
      phone: client.phone ?? "",
      address: client.address ?? "",
    });
    setModalOpen(true);
  };

  /* Soumettre le formulaire */
  const onSubmit = async (data: ClientForm) => {
    setSubmitting(true);
    setApiError(null);
    try {
      const url = editingClient
        ? `/api/clients/${editingClient.id}`
        : "/api/clients";
      const method = editingClient ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        setModalOpen(false);
        await fetchClients();
      } else {
        const json = await res.json().catch(() => ({}));
        setApiError(json.error ?? `Erreur ${res.status}`);
      }
    } catch {
      setApiError("Erreur réseau, réessayez.");
    } finally {
      setSubmitting(false);
    }
  };

  /* Ouvrir confirmation suppression */
  const openDelete = (client: Client) => {
    setDeletingClient(client);
    setDeleteDialogOpen(true);
  };

  /* Confirmer suppression */
  const confirmDelete = async () => {
    if (!deletingClient) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clients/${deletingClient.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setDeleteDialogOpen(false);
        await fetchClients();
      }
    } finally {
      setDeleting(false);
    }
  };

  /* ── Render ─────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mes clients</h1>
          <p className="text-sm text-slate-500 mt-1">
            {clients.length} client{clients.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={openAdd}
          className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          Ajouter un client
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : clients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
              <Users className="h-6 w-6 text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-600">Aucun client pour l&apos;instant</p>
            <p className="text-xs text-slate-400 mt-1">
              Cliquez sur &ldquo;Ajouter un client&rdquo; pour commencer
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Adresse</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium text-slate-900">
                    {client.name}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {client.phone ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {client.email ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="text-slate-600 max-w-[200px] truncate">
                    {client.address ?? <span className="text-slate-300">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => openEdit(client)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 border border-slate-200 hover:border-blue-300 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier
                      </button>
                      <button
                        onClick={() => openDelete(client)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-300 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ── Modal Ajouter / Modifier ──────────────────── */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? "Modifier le client" : "Ajouter un client"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Nom */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-sm font-medium text-slate-700">
                Nom <span className="text-red-500">*</span>
              </label>
              <input
                id="name"
                className={inputCls}
                placeholder="Ex : Martin Dupont"
                {...register("name")}
              />
              {errors.name && (
                <p className="text-xs text-red-500">{errors.name.message}</p>
              )}
            </div>

            {/* Téléphone */}
            <div className="space-y-1.5">
              <label htmlFor="phone" className="text-sm font-medium text-slate-700">
                Téléphone
              </label>
              <input
                id="phone"
                className={inputCls}
                placeholder="Ex : 06 12 34 56 78"
                {...register("phone")}
              />
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                className={inputCls}
                placeholder="Ex : martin@email.fr"
                {...register("email")}
              />
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            {/* Adresse */}
            <div className="space-y-1.5">
              <label htmlFor="address" className="text-sm font-medium text-slate-700">
                Adresse
              </label>
              <input
                id="address"
                className={inputCls}
                placeholder="Ex : 12 rue de la Paix, 75001 Paris"
                {...register("address")}
              />
            </div>

            {/* Erreur API */}
            {apiError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {apiError}
              </p>
            )}

            {/* Boutons */}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-sm font-medium text-slate-600 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-lg transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleSubmit(onSubmit)()}
                className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingClient ? "Enregistrer" : "Ajouter"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modal Confirmation suppression ───────────── */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Supprimer le client</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-600 py-2">
            Êtes-vous sûr de vouloir supprimer{" "}
            <span className="font-semibold text-slate-900">
              {deletingClient?.name}
            </span>{" "}
            ? Cette action est irréversible.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setDeleteDialogOpen(false)}
              className="text-sm font-medium text-slate-600 border border-slate-300 hover:border-slate-400 px-4 py-2 rounded-lg transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={confirmDelete}
              disabled={deleting}
              className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              Supprimer
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
