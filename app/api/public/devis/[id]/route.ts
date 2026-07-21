import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Public read-only endpoint — utilisé par la page d'impression, à la fois
// pour le propriétaire (téléchargement PDF interne) et pour le client final
// (lien partagé). Le CUID agit comme jeton non-devinable.
// L'expiration/révocation du lien ne s'applique jamais au propriétaire.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const devis = await prisma.devis.findUnique({
      where: { id: params.id },
      include: {
        client: true,
        lines:  true,
        user: {
          include: { settings: true },
        },
      },
    });

    if (!devis) {
      return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
    }

    const { userId: clerkId } = await auth();
    const isOwner = !!clerkId && clerkId === (await prisma.user.findUnique({
      where: { id: devis.userId },
      select: { clerkId: true },
    }))?.clerkId;

    if (!isOwner) {
      if (devis.linkRevoked) {
        return NextResponse.json({ error: "Ce lien a été révoqué" }, { status: 403 });
      }
      if (devis.linkExpiresAt && devis.linkExpiresAt < new Date()) {
        return NextResponse.json({ error: "Ce lien a expiré" }, { status: 403 });
      }
    }

    return NextResponse.json(devis);
  } catch (err) {
    console.error("[GET /api/public/devis/:id]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
