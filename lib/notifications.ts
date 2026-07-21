import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "paiement_echoue"
  | "abonnement_expire_bientot"
  | "facture_en_retard"
  | "relance_envoyee"
  | "relance_echouee"
  | "devis_accepte";

export async function createNotification(
  userId: string,
  type: NotificationType,
  message: string,
  link?: string
) {
  await prisma.notification.create({
    data: { userId, type, message, link: link ?? null },
  });
}

// Évite les doublons pour les notifications "état" (une seule par ressource,
// ex. facture en retard) plutôt que "événement" (relance envoyée peut se
// répéter légitimement à chaque niveau).
export async function createNotificationOnce(
  userId: string,
  type: NotificationType,
  message: string,
  link: string
) {
  const existing = await prisma.notification.findFirst({ where: { userId, type, link } });
  if (existing) return;
  await createNotification(userId, type, message, link);
}
