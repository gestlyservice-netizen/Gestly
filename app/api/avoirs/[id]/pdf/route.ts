import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDocumentPdfBuffer } from "@/lib/pdf/generate-document-pdf";

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const avoir = await prisma.avoir.findFirst({
    where: { id: params.id, userId: user.id },
    include: { client: true, lines: true, facture: true },
  });
  if (!avoir) return NextResponse.json({ error: "Avoir introuvable" }, { status: 404 });

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });

  const pdfBuffer = generateDocumentPdfBuffer({
    docTypeLabel: "AVOIR",
    number: avoir.number,
    metaLines: [
      { label: "Date", value: fmtDate(avoir.createdAt) },
      { label: "Facture d'origine", value: avoir.facture.number },
    ],
    client: avoir.client,
    lines: avoir.lines,
    totalHT: avoir.totalHT,
    totalTVA: avoir.totalTVA,
    totalTTC: avoir.totalTTC,
    extraNote: `Motif : ${avoir.reason}`,
    settings,
  });

  return new NextResponse(new Blob([new Uint8Array(pdfBuffer)]), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="avoir-${avoir.number}.pdf"`,
    },
  });
}
