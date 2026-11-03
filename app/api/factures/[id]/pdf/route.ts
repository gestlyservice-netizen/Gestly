import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateFacturePdfBuffer } from "@/lib/pdf/generate-document-pdf";

// Téléchargement du PDF d'une facture depuis le dashboard : identique à la
// pièce jointe de l'email (app/api/factures/[id]/send).
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  try {
    const facture = await prisma.facture.findFirst({
      where: { id: params.id, userId: user.id },
      include: { client: true, lines: true, devis: { include: { lines: true } } },
    });
    if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

    const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    const lines = facture.lines.length > 0 ? facture.lines : facture.devis?.lines ?? [];
    const pdfBuffer = generateFacturePdfBuffer(facture, lines, facture.client, settings);

    return new NextResponse(new Blob([new Uint8Array(pdfBuffer)]), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="facture-${facture.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/factures/:id/pdf]", err);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
