import { prisma } from "@/lib/prisma";
import { createDevis, CreateDevisError, type CreateDevisLineInput } from "@/lib/devis/create-devis";
import { createClient } from "@/lib/clients/create-client";
import { DEFAULT_TVA_RATE } from "@/lib/ai/config";
import { computeMissingRequirements, type PendingDevis } from "@/lib/whatsapp/pending-devis";

// Délai après lequel un état "creating" est considéré comme abandonné
// (crash pendant la création) plutôt que réellement en cours — ne doit
// JAMAIS être immédiatement reprenable : c'est justement cet état qui sert
// à empêcher deux tentatives concurrentes de créer chacune un devis. Le
// rendre reprenable sans délai annulerait l'exclusion mutuelle elle-même.
const STALE_CREATING_MS = 5 * 60 * 1000; // 5 minutes, aligné sur job-queue.ts

export type ConfirmationOutcome =
  | { kind: "created"; devisId: string; number: string; totalTTC: number; clientName: string }
  | { kind: "already_created"; devisId: string; number: string; totalTTC: number; clientName: string }
  | { kind: "not_claimed" }
  | { kind: "insufficient_data"; missing: string[] };

// Crée réellement le devis (et le client si besoin) à partir d'un brouillon
// prêt, de façon idempotente et transactionnelle. Une confirmation ne
// produit jamais deux créations :
// - réclamation atomique de l'état de la conversation (updateMany
//   conditionné, même pattern que lib/whatsapp/job-queue.ts) : si un autre
//   traitement a déjà gagné la course, celui-ci abandonne sans rien créer ;
// - toute la création (client + devis + lignes + mise à jour de l'état) a
//   lieu dans une seule transaction Prisma : en cas d'erreur à n'importe
//   quelle étape, tout est annulé, aucun état métier partiel ne subsiste ;
// - en cas d'échec après réclamation, l'état revient à
//   "awaiting_creation_confirmation" pour permettre un nouvel essai propre.
export async function confirmDevisCreation(
  conversationId: string,
  userId: string,
  pendingDevis: PendingDevis
): Promise<ConfirmationOutcome> {
  const staleBefore = new Date(Date.now() - STALE_CREATING_MS);
  const claim = await prisma.whatsappConversation.updateMany({
    where: {
      id: conversationId,
      OR: [
        { state: "awaiting_creation_confirmation" },
        { state: "creating", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { state: "creating" },
  });

  if (claim.count === 0) {
    return resolveAlreadySettled(conversationId);
  }

  // Vérification explicite de complétude (au lieu de laisser la transaction
  // échouer plus loin) — permet de répondre précisément sur ce qui manque,
  // et de revenir proprement en confirmation en attente plutôt qu'en échec.
  const missing = computeMissingRequirements(pendingDevis);
  if (missing.length > 0) {
    await prisma.whatsappConversation.updateMany({
      where: { id: conversationId, state: "creating" },
      data: { state: "awaiting_creation_confirmation" },
    });
    return { kind: "insufficient_data", missing };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      let clientId = pendingDevis.client.matchedClientId;

      if (clientId) {
        // Client déjà identifié via une résolution CRM non ambiguë : on le
        // réutilise IMPÉRATIVEMENT, jamais de doublon créé.
        const existing = await tx.client.findFirst({ where: { id: clientId, userId } });
        if (!existing) throw new CreateDevisError("Client précédemment identifié introuvable", "CLIENT_NOT_FOUND");
      } else {
        if (!pendingDevis.client.nomMentionne) {
          throw new CreateDevisError("Nom du client manquant pour créer un nouveau client", "NO_CLIENT");
        }
        const newClient = await createClient(
          {
            userId,
            name: pendingDevis.client.nomMentionne,
            phone: pendingDevis.client.telephone.value,
            email: pendingDevis.client.email.value,
            address: pendingDevis.client.adresse.value,
          },
          tx
        );
        clientId = newClient.id;
      }

      const lines: CreateDevisLineInput[] = pendingDevis.lignes.map((l) => {
        const quantity = l.quantite.value ?? 1;
        // Si seul un montant total est connu (pas de prix unitaire), le
        // prix unitaire se déduit par arithmétique exacte (montant/quantité)
        // — ce n'est pas une supposition métier, juste la représentation
        // correcte d'un total déjà connu dans un schéma quantité×prix.
        const unitPriceHT = l.prixUnitaire.value ?? (l.montant.value !== null ? l.montant.value / quantity : 0);
        return {
          description: l.description,
          quantity,
          unitPriceHT,
          tvaRate: l.tva.value ?? DEFAULT_TVA_RATE,
        };
      });

      const devis = await createDevis(
        {
          userId,
          clientId: clientId!,
          notes: pendingDevis.notes.value,
          lines,
          // Jamais "envoye" à cette étape — la création n'implique aucun envoi.
          status: "brouillon",
        },
        tx
      );

      await tx.whatsappConversation.update({
        where: { id: conversationId },
        data: { state: "awaiting_send_confirmation", lastCreatedDevisId: devis.id },
      });

      return devis;
    });

    const client = await prisma.client.findUnique({ where: { id: created.clientId } });
    return {
      kind: "created",
      devisId: created.id,
      number: created.number,
      totalTTC: created.totalTTC,
      clientName: client?.name ?? pendingDevis.client.nomMentionne ?? "",
    };
  } catch (err) {
    // Échec à n'importe quelle étape : la transaction a déjà tout annulé
    // (aucun Client/Devis partiel en base). On ramène juste l'état de la
    // conversation à un point ré-attaquable proprement.
    await prisma.whatsappConversation.updateMany({
      where: { id: conversationId, state: "creating" },
      data: { state: "awaiting_creation_confirmation" },
    });
    throw err;
  }
}

async function resolveAlreadySettled(conversationId: string): Promise<ConfirmationOutcome> {
  const conv = await prisma.whatsappConversation.findUnique({ where: { id: conversationId } });

  if (conv?.state === "awaiting_send_confirmation" && conv.lastCreatedDevisId) {
    const devis = await prisma.devis.findUnique({
      where: { id: conv.lastCreatedDevisId },
      include: { client: true },
    });
    if (devis) {
      return {
        kind: "already_created",
        devisId: devis.id,
        number: devis.number,
        totalTTC: devis.totalTTC,
        clientName: devis.client.name,
      };
    }
  }

  return { kind: "not_claimed" };
}
