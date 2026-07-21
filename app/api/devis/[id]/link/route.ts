import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Gestion du lien public de partage : expiration, révocation, régénération.
// Le propriétaire n'est jamais bloqué par ces champs (voir /api/public/devis/:id).
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await prisma.devis.findFirst({ where: { id: params.id, userId: user.id } });
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => ({}));
  const { action, expiresInDays } = (body ?? {}) as { action?: string; expiresInDays?: number };

  let data: { linkRevoked?: boolean; linkExpiresAt?: Date | null };

  switch (action) {
    case "revoke":
      data = { linkRevoked: true };
      break;
    case "regenerate": {
      // Ré-active l'accès et repousse l'expiration — voir la limite documentée
      // dans le rapport d'audit (l'identifiant du lien reste le même, seule
      // sa validité est réinitialisée).
      const days = Number.isFinite(expiresInDays) && expiresInDays! > 0 ? expiresInDays! : 30;
      data = {
        linkRevoked: false,
        linkExpiresAt: new Date(Date.now() + days * 86_400_000),
      };
      break;
    }
    case "set_expiration": {
      if (expiresInDays === null || expiresInDays === undefined) {
        data = { linkExpiresAt: null };
      } else {
        const days = Number(expiresInDays);
        if (!Number.isFinite(days) || days <= 0) {
          return NextResponse.json({ error: "Durée invalide" }, { status: 400 });
        }
        data = { linkExpiresAt: new Date(Date.now() + days * 86_400_000) };
      }
      break;
    }
    default:
      return NextResponse.json({ error: "Action invalide" }, { status: 400 });
  }

  const updated = await prisma.devis.update({ where: { id: params.id }, data });
  return NextResponse.json({
    linkRevoked: updated.linkRevoked,
    linkExpiresAt: updated.linkExpiresAt,
  });
}
