import { prisma } from "@/lib/prisma";
import { normalizePhoneE164 } from "@/lib/phone";
import type { User } from "@prisma/client";

// Résolution de l'artisan expéditeur par numéro normalisé. Scan en mémoire
// sur les utilisateurs ayant un téléphone renseigné : le volume attendu en
// V1 (une base d'artisans, pas de clients finaux) rend cette approche large-
// ment suffisante. À revoir (index applicatif ou colonne normalisée dédiée)
// si le nombre d'utilisateurs devient significatif.
export async function resolveUserByPhone(rawSenderPhone: string): Promise<User | null> {
  const target = normalizePhoneE164(rawSenderPhone);
  const candidates = await prisma.user.findMany({ where: { phone: { not: null } } });
  return candidates.find((u) => u.phone && normalizePhoneE164(u.phone) === target) ?? null;
}
