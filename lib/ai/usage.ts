import { prisma } from "@/lib/prisma";

// Mécanisme 3, isolé : comptage d'usage IA et plafond associé. Ce module ne
// décide jamais lui-même quoi faire d'un message — il expose seulement
// "combien d'appels réels ce mois-ci" et "le plafond est-il atteint",
// charge à l'appelant (lib/whatsapp/agent.ts) d'agir en conséquence.
//
// Un seul plafond combiné (extraction + transcription) pour cette V1 :
// volontairement simple, la donnée brute (kind, succès/échec, tokens, durée)
// reste disponible pour affiner plus tard sans migration supplémentaire.
//
// IMPORTANT : ce n'est PAS une offre commerciale. C'est un garde-fou
// technique provisoire, choisi haut pour ne jamais gêner un usage normal
// pendant les tests, mais suffisant pour empêcher un abus flagrant (boucle,
// bug, message malveillant) de générer un coût IA illimité. La valeur
// définitive de l'offre Gestly sera décidée séparément, sur la base des
// données réelles que ce compteur permet de collecter.
export const DEFAULT_MONTHLY_AI_LIMIT = 300;

export function getMonthlyAiLimit(): number {
  const raw = process.env.WHATSAPP_AI_MONTHLY_LIMIT;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MONTHLY_AI_LIMIT;
}

export type AiUsageKind = "extraction" | "transcription";

export interface AiUsageEventInput {
  userId: string;
  kind: AiUsageKind;
  success: boolean;
  inputTokens?: number | null;
  outputTokens?: number | null;
  audioSeconds?: number | null;
}

// Enregistre un appel IA réellement effectué. Appelé au plus près de l'appel
// réseau réel (lib/whatsapp/extraction.ts, lib/whatsapp/transcription.ts),
// jamais de façon spéculative avant. Un retry qui déclenche un second appel
// réel au fournisseur est donc légitimement compté une seconde fois — ce
// n'est pas un double comptage du même appel, c'est un second appel réel
// avec un second coût réel. Compatible avec l'idempotence existante :
// lib/whatsapp/voice-message.ts empêche déjà un second appel de
// transcription réel pour un message déjà transcrit (court-circuit sur
// transcriptionStatus="done"), donc aucun événement n'est créé dans ce cas.
export async function recordAiUsage(event: AiUsageEventInput): Promise<void> {
  await prisma.aiUsageEvent.create({
    data: {
      userId: event.userId,
      kind: event.kind,
      success: event.success,
      inputTokens: event.inputTokens ?? null,
      outputTokens: event.outputTokens ?? null,
      audioSeconds: event.audioSeconds ?? null,
    },
  });
}

function startOfCurrentMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

// Agrégation strictement filtrée par userId : jamais mélangée entre
// artisans, quel que soit le volume d'un autre compte. Compte les appels
// réussis ET échoués (un appel échoué a quand même un coût réel côté
// fournisseur, et ne pas le compter ouvrirait une façon triviale de
// dépasser le plafond en forçant des échecs).
export async function getMonthlyAiUsageCount(userId: string, now: Date = new Date()): Promise<number> {
  return prisma.aiUsageEvent.count({
    where: { userId, createdAt: { gte: startOfCurrentMonth(now) } },
  });
}

export async function isAiQuotaExceeded(userId: string, now: Date = new Date()): Promise<boolean> {
  const count = await getMonthlyAiUsageCount(userId, now);
  return count >= getMonthlyAiLimit();
}
