import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { findRetryableJobIds } from "@/lib/whatsapp/job-queue";
import { processWhatsappJob } from "@/lib/whatsapp/agent";

const ADMIN_EMAIL = "gestlyservice@gmail.com";

// Filet de sécurité pour le déclenchement immédiat (waitUntil) du webhook :
// reprend tout WhatsappJob resté pending, en échec avec des tentatives
// restantes, ou bloqué en "processing" trop longtemps (traitement précédent
// probablement interrompu). Même pattern d'autorisation que les autres
// routes de cron existantes (CRON_SECRET, avec repli sur l'admin connecté).
async function isAuthorized(request: Request): Promise<boolean> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization");
    if (header === `Bearer ${cronSecret}`) return true;
  }
  const { userId } = await auth();
  if (!userId) return false;
  const user = await prisma.user.findUnique({ where: { clerkId: userId } });
  return user?.email === ADMIN_EMAIL;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const jobIds = await findRetryableJobIds();
  let processed = 0;
  for (const jobId of jobIds) {
    // processWhatsappJob renvoie false si un autre process a déjà réclamé ce
    // job entre-temps (concurrence) — on ne compte que les prises en charge
    // réelles, pas les simples tentatives.
    if (await processWhatsappJob(jobId)) processed++;
  }

  return NextResponse.json({ ok: true, candidates: jobIds.length, processed });
}
