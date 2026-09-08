import { prisma } from "@/lib/prisma";

// Mêmes limites de principe que lib/relances/engine.ts (MAX_ATTEMPTS = 5),
// pour rester cohérent avec le reste du code.
export const MAX_ATTEMPTS = 5;
export const STALE_PROCESSING_MS = 5 * 60 * 1000; // 5 minutes

// Réclame un job pour traitement exclusif via une seule requête UPDATE
// atomique côté Postgres : si deux appels concurrents tentent de réclamer
// le même job, un seul verra la ligne encore dans un état éligible au
// moment où son UPDATE s'exécute — l'autre ne modifie aucune ligne (count:0)
// et abandonne proprement. Aucun verrou applicatif nécessaire.
//
// Éligible : pending (jamais traité), failed avec tentatives restantes
// (retry), ou processing depuis trop longtemps (traitement précédent
// probablement interrompu — crash, timeout).
export async function claimJob(jobId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);

  const claimed = await prisma.whatsappJob.updateMany({
    where: {
      id: jobId,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "pending" },
        { status: "failed" },
        { status: "processing", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { status: "processing", attempts: { increment: 1 } },
  });

  return claimed.count === 1;
}

export async function findRetryableJobIds(limit = 50): Promise<string[]> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const jobs = await prisma.whatsappJob.findMany({
    where: {
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { status: "pending" },
        { status: "failed" },
        { status: "processing", updatedAt: { lt: staleBefore } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  return jobs.map((j) => j.id);
}
