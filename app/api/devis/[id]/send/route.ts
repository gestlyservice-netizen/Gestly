import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/outbound/email";
import { isOutboundDisabled, OUTBOUND_DISABLED_MESSAGE } from "@/lib/outbound/mode";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublicUrl } from "@/lib/url";
import { parseEmailAddress } from "@/lib/email/address";
import { generateDevisPdfBuffer } from "@/lib/pdf/generate-document-pdf";
import {
  buildDevisEmail,
  devisPdfFilename,
  documentEmailFrom,
  isDocumentEmailRateLimited,
  raisonSociale,
  replyToFrom,
  DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE,
} from "@/lib/documents/document-email";

// Envoi d'un devis par email au client : corps HTML (données échappées) +
// version texte + PDF joint (même moteur que le bouton « PDF » et WhatsApp).
// Le devis n'est marqué envoyé qu'après le retour normal de sendEmail().
export async function POST(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }
  // Bêta privée : refus explicite, le devis n'est pas marqué envoyé.
  if (isOutboundDisabled()) return NextResponse.json({ error: OUTBOUND_DISABLED_MESSAGE }, { status: 503 });

  const devis = await prisma.devis.findFirst({
    where: { id: params.id, userId: user.id },
    include: { client: true, lines: true },
  });
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  if (!devis.client.email?.trim()) {
    return NextResponse.json({ error: "Ce client n'a pas d'adresse email" }, { status: 400 });
  }
  const to = parseEmailAddress(devis.client.email);
  if (!to) {
    return NextResponse.json(
      { error: "L'adresse email de ce client est invalide : corrigez-la dans sa fiche" },
      { status: 400 }
    );
  }

  if (isDocumentEmailRateLimited(user.id, "devis", devis.id)) {
    return NextResponse.json({ error: DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE }, { status: 429 });
  }

  const settings = await prisma.settings.findUnique({ where: { userId: user.id } });

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = generateDevisPdfBuffer(devis, devis.lines, devis.client, settings);
  } catch (err) {
    console.error("[POST /api/devis/:id/send] Génération PDF:", err);
    return NextResponse.json({ error: "Échec de la génération du PDF" }, { status: 500 });
  }

  const { subject, html, text } = buildDevisEmail({
    ...devis,
    lines: devis.lines,
    clientName: devis.client.name,
    companyName: raisonSociale(settings, user),
    onlineUrl: `${getPublicUrl()}/print/devis/${encodeURIComponent(devis.id)}`,
  });

  try {
    // sendEmail lève une exception si Resend refuse l'email : le devis n'est
    // alors PAS marqué envoyé (catch ci-dessous).
    await sendEmail({
      from: documentEmailFrom(),
      to,
      subject,
      html,
      text,
      ...replyToFrom(settings?.emailPro),
      attachments: [{ filename: devisPdfFilename(devis.number), content: pdfBuffer }],
    });
  } catch (err) {
    console.error("[POST /api/devis/:id/send] Resend error:", err);
    return NextResponse.json({ error: "Échec de l'envoi de l'email" }, { status: 500 });
  }

  try {
    // Brouillon → envoyé ; un devis déjà signé ou refusé garde son statut.
    const updated = await prisma.devis.update({
      where: { id: devis.id },
      data: {
        status: devis.status === "brouillon" ? "envoye" : devis.status,
        sentAt: devis.sentAt ?? new Date(),
      },
      include: { client: true, lines: true },
    });
    return NextResponse.json(updated);
  } catch (err) {
    // L'email est parti : le signaler pour éviter un second envoi au client.
    console.error("[POST /api/devis/:id/send] Enregistrement après envoi:", err);
    return NextResponse.json(
      { error: "L'email a été envoyé, mais son enregistrement a échoué. Rechargez la page avant tout nouvel envoi." },
      { status: 500 }
    );
  }
}
