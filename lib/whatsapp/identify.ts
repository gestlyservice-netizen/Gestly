import { prisma } from "@/lib/prisma";
import { normalizePhoneE164 } from "@/lib/phone";
import type { User } from "@prisma/client";

// Résolution de l'artisan expéditeur par numéro normalisé. Scan en mémoire
// sur les utilisateurs ayant un téléphone renseigné : le volume attendu en
// V1 (une base d'artisans, pas de clients finaux) rend cette approche large-
// ment suffisante. À revoir (index applicatif ou colonne normalisée dédiée)
// si le nombre d'utilisateurs devient significatif.
//
// Isolation entre comptes : si plusieurs comptes Gestly déclarent le même
// numéro, l'expéditeur n'est PAS identifiable sans ambiguïté — le message
// n'est attribué à aucun compte (jamais au premier trouvé, ce qui pourrait
// créer des clients et devis dans le compte d'un autre artisan).
export async function resolveUserByPhone(rawSenderPhone: string): Promise<User | null> {
  const target = normalizePhoneE164(rawSenderPhone);
  const candidates = await prisma.user.findMany({ where: { phone: { not: null } } });
  const matches = candidates.filter((u) => u.phone && normalizePhoneE164(u.phone) === target);
  if (matches.length > 1) {
    console.warn(`[whatsapp/identify] numéro partagé par ${matches.length} comptes Gestly — message non attribué`);
    return null;
  }
  return matches[0] ?? null;
}
