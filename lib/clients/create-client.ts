import type { Prisma, PrismaClient, Client } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeClientEmail } from "@/lib/clients/client-email";

// Règles métier extraites de app/api/clients/route.ts (POST) — seule règle
// obligatoire : le nom. Tout le reste est optionnel et normalisé de la même
// façon (trim, null si vide). Réutilisé par l'API web et par la création de
// devis depuis WhatsApp, pour ne jamais dupliquer cette logique.
export interface CreateClientInput {
  userId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  preferredContact?: string | null;
  /**
   * Adresse email invalide : "reject" (défaut, formulaires et API → erreur
   * EMAIL_INVALID) ou "ignore" (agent WhatsApp : une adresse mal transcrite
   * ne doit pas empêcher la création du devis ; le client est créé sans
   * email, à compléter dans sa fiche).
   */
  invalidEmail?: "reject" | "ignore";
}

const VALID_CHANNELS = ["whatsapp", "email", "telephone"];

export class CreateClientError extends Error {
  constructor(message: string, readonly code: "NAME_REQUIRED" | "EMAIL_INVALID") {
    super(message);
    this.name = "CreateClientError";
  }
}

export async function createClient(
  input: CreateClientInput,
  tx: Prisma.TransactionClient | PrismaClient = prisma
): Promise<Client> {
  const name = input.name?.trim();
  if (!name) throw new CreateClientError("Le nom est obligatoire", "NAME_REQUIRED");

  const email = normalizeClientEmail(input.email);
  if (!email.ok && input.invalidEmail !== "ignore") throw new CreateClientError(email.error, "EMAIL_INVALID");

  return tx.client.create({
    data: {
      userId: input.userId,
      name,
      email: email.ok ? email.email : null,
      phone: input.phone?.trim() || null,
      address: input.address?.trim() || null,
      preferredContact:
        input.preferredContact && VALID_CHANNELS.includes(input.preferredContact)
          ? input.preferredContact
          : "email",
    },
  });
}
