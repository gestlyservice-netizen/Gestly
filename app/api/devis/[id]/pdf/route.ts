import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDevisPdfBuffer } from "@/lib/pdf/generate-document-pdf";

// Téléchargement du PDF d'un devis depuis le dashboard : même moteur que la
// pièce jointe WhatsApp. Remplace la capture html2canvas de /print/devis, dont
// la fenêtre se refermait avant que Chrome ne démarre le téléchargement.
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
    const devis = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
      include: { client: true, lines: true },
    });
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
    const pdfBuffer = generateDevisPdfBuffer(devis, devis.lines, devis.client, settings);

    return new NextResponse(new Blob([new Uint8Array(pdfBuffer)]), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="devis-${devis.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    console.error("[GET /api/devis/:id/pdf]", err);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }
}
