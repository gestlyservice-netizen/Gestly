import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public read-only endpoint — used by the print page (no auth required).
// The CUID acts as an unguessable token.
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

    return NextResponse.json(devis);
  } catch (err) {
    console.error("[GET /api/public/devis/:id]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
