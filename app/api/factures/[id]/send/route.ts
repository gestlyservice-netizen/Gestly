import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateDocumentPdfBuffer } from "@/lib/pdf/generate-document-pdf";

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const facture = await prisma.facture.findFirst({
    where: { id: params.id, userId: user.id },
    include: { client: true, lines: true, devis: { include: { lines: true } } },
  });
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => ({}));
  const overrides = (body ?? {}) as { to?: string; subject?: string; message?: string };

  const to = overrides.to?.trim() || facture.client.email;
  if (!to) {
    return NextResponse.json(
      { error: "Ce client n'a pas d'adresse email — renseignez un destinataire" },
      { status: 400 }
    );
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  const lines = facture.lines.length > 0 ? facture.lines : facture.devis?.lines ?? [];

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = generateDocumentPdfBuffer({
      docTypeLabel: "FACTURE",
      number: facture.number,
      metaLines: [
        { label: "Date", value: fmtDate(facture.createdAt) },
        ...(facture.dueDate ? [{ label: "Échéance", value: fmtDate(facture.dueDate) }] : []),
      ],
      client: facture.client,
      lines,
      totalHT: facture.totalHT,
      totalTVA: facture.totalTVA,
      totalTTC: facture.totalTTC,
      notes: facture.notes,
      settings,
    });
  } catch (err) {
    console.error("[POST /api/factures/:id/send] Génération PDF:", err);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }

  const subject = overrides.subject?.trim() || `Facture ${facture.number} — ${user.companyName}`;
  const message =
    overrides.message?.trim() ||
    `Bonjour ${facture.client.name},\n\nVeuillez trouver ci-joint votre facture ${facture.number} d'un montant de ${facture.totalTTC.toLocaleString("fr-FR", { minimumFractionDigits: 2 })} € TTC.\n\nCordialement,\n${user.companyName}`;

  const resend = new Resend(process.env.RESEND_API_KEY);
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>",
      to,
      subject,
      text: message,
      attachments: [
        {
          filename: `facture-${facture.number}.pdf`,
          content: pdfBuffer,
        },
      ],
    });
  } catch (err) {
    console.error("[POST /api/factures/:id/send] Resend error:", err);
    return NextResponse.json({ error: "Échec de l'envoi de l'email" }, { status: 500 });
  }

  const updated = await prisma.facture.update({
    where: { id: params.id },
    data: { sentAt: new Date() },
    include: { client: true, lines: true },
  });

  return NextResponse.json(updated);
}
