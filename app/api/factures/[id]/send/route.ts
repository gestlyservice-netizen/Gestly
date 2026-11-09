import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/outbound/email";
import { isOutboundDisabled, OUTBOUND_DISABLED_MESSAGE } from "@/lib/outbound/mode";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseEmailAddress } from "@/lib/email/address";
import { generateFacturePdfBuffer } from "@/lib/pdf/generate-document-pdf";
import {
  defaultFactureEmail,
  documentEmailFrom,
  facturePdfFilename,
  isDocumentEmailRateLimited,
  parseFactureEmailOverrides,
  replyToFrom,
  DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE,
} from "@/lib/documents/document-email";

// Envoi d'une facture par email (texte brut + PDF joint). Destinataire, objet
// et message peuvent être modifiés dans la fenêtre d'envoi ; le destinataire
// doit être UNE adresse valide. La facture n'est marquée envoyée qu'après le
// retour normal de sendEmail().
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }
  // Bêta privée : refus explicite, la facture n'est pas marquée envoyée.
  if (isOutboundDisabled()) return NextResponse.json({ error: OUTBOUND_DISABLED_MESSAGE }, { status: 503 });

  const facture = await prisma.facture.findFirst({
    where: { id: params.id, userId: user.id },
    include: { client: true, lines: true, devis: { include: { lines: true } } },
  });
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => ({}));
  const overrides = parseFactureEmailOverrides(body);
  if (!overrides.ok) return NextResponse.json({ error: overrides.error }, { status: 400 });

  let to = overrides.to;
  if (!to) {
    if (!facture.client.email?.trim()) {
      return NextResponse.json(
        { error: "Ce client n'a pas d'adresse email — renseignez un destinataire" },
        { status: 400 }
      );
    }
    to = parseEmailAddress(facture.client.email);
    if (!to) {
      return NextResponse.json(
        { error: "L'adresse email de ce client est invalide : corrigez-la ou saisissez un destinataire" },
        { status: 400 }
      );
    }
  }

  if (isDocumentEmailRateLimited(user.id, "facture", facture.id)) {
    return NextResponse.json({ error: DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });
  const lines = facture.lines.length > 0 ? facture.lines : facture.devis?.lines ?? [];

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = generateFacturePdfBuffer(facture, lines, facture.client, settings);
  } catch (err) {
    console.error("[POST /api/factures/:id/send] Génération PDF:", err);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }

  const defaults = defaultFactureEmail({
    number: facture.number,
    totalTTC: facture.totalTTC,
    clientName: facture.client.name,
    companyName: user.companyName || settings?.companyName || "",
  });

  try {
    // sendEmail lève une exception si Resend refuse l'email : la facture
    // n'est alors PAS marquée envoyée (catch ci-dessous).
    await sendEmail({
      from: documentEmailFrom(),
      to,
      subject: overrides.subject ?? defaults.subject,
      text: overrides.message ?? defaults.message,
      ...replyToFrom(settings?.emailPro),
      attachments: [{ filename: facturePdfFilename(facture.number), content: pdfBuffer }],
    });
  } catch (err) {
    console.error("[POST /api/factures/:id/send] Resend error:", err);
    return NextResponse.json({ error: "Échec de l'envoi de l'email" }, { status: 500 });
  }

  try {
    const updated = await prisma.facture.update({
      where: { id: facture.id },
      data: { sentAt: new Date() },
      include: { client: true, lines: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    // L'email est parti : le signaler pour éviter un second envoi au client.
    console.error("[POST /api/factures/:id/send] Enregistrement après envoi:", err);
    return NextResponse.json(
      { error: "L'email a été envoyé, mais son enregistrement a échoué. Rechargez la page avant tout nouvel envoi." },
      { status: 500 }
    );
  }
}
