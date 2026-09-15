import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "paiement_echoue"
  | "abonnement_expire_bientot"
  | "facture_en_retard"
  | "relance_envoyee"
  | "relance_echouee"
  | "devis_accepte"
  | "whatsapp_escalade";

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
//
// Unicité garantie au niveau base de données (étape 8bis), pas par la seule
// convention applicative : dedupeKey encode l'incident (type+link) et porte
// un index UNIQUE PARTIEL sur (userId, dedupeKey) — cf.
// prisma/manual-migrations/20260915_step8bis_notification_dedupe_up.sql.
// Un INSERT direct (plutôt qu'un findFirst puis create, non atomique) : sous
// course concurrente, un seul appel réussit, l'autre reçoit une violation de
// contrainte et l'ignore silencieusement — jamais deux notifications pour le
// même incident, même avec des retries simultanés. dedupeKey reste null
// pour createNotification (relances, etc.), donc cet index ne les concerne
// jamais.
export async function createNotificationOnce(
  userId: string,
  type: NotificationType,
  message: string,
  link: string
) {
  try {
    await prisma.notification.create({
      data: { userId, type, message, link, dedupeKey: `${type}:${link}` },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Déjà notifié pour cet incident — course perdue contre un appel
      // concurrent (ou appel répété), pas une erreur.
      return;
    }
    throw err;
  }
}
