import { NextResponse } from "next/server";
import { Resend } from "resend";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const resend = new Resend(process.env.RESEND_API_KEY);

const fmt = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: Date | string | null) =>
  d ? new Date(d).toLocaleDateString("fr-FR") : "—";

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const devis = await prisma.devis.findFirst({
    where: { id: params.id, userId: user.id },
    include: { client: true, lines: true },
  });

  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

  if (!devis.client.email) {
    return NextResponse.json(
      { error: "Ce client n'a pas d'adresse email" },
      { status: 400 }
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const pdfUrl = `${appUrl}/print/devis/${devis.id}`;

  const expiryDate = new Date(devis.createdAt);
  expiryDate.setDate(expiryDate.getDate() + devis.validityDays);

  const linesRows = devis.lines
    .map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (l: any) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155">${l.description}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;text-align:right">${l.quantity}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;text-align:right">${fmt(l.unitPriceHT)} €</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;text-align:right">${l.tvaRate} %</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;font-weight:600;color:#1e293b;text-align:right">${fmt(l.totalHT)} €</td>
      </tr>`
    )
    .join("");

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:620px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:#1e40af;padding:32px 40px">
      <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px">${user.companyName}</div>
      <div style="color:#93c5fd;font-size:13px;margin-top:4px">Devis ${devis.number}</div>
    </div>

    <!-- Body -->
    <div style="padding:40px">
      <p style="margin:0 0 24px;color:#475569;font-size:15px">
        Bonjour <strong style="color:#1e293b">${devis.client.name}</strong>,
      </p>
      <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.6">
        Veuillez trouver ci-dessous votre devis <strong>${devis.number}</strong> pour un montant de
        <strong style="color:#1e40af">${fmt(devis.totalTTC)} € TTC</strong>,
        valable jusqu'au <strong>${fmtDate(expiryDate)}</strong>.
      </p>

      <!-- Lines table -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Description</th>
            <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Qté</th>
            <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Prix HT</th>
            <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">TVA</th>
            <th style="padding:10px 12px;text-align:right;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0">Total HT</th>
          </tr>
        </thead>
        <tbody>${linesRows}</tbody>
      </table>

      <!-- Totals -->
      <div style="display:flex;justify-content:flex-end">
        <table cellpadding="0" cellspacing="0" style="width:240px;font-size:14px">
          <tr>
            <td style="padding:6px 0;color:#64748b">Total HT</td>
            <td style="padding:6px 0;text-align:right;color:#1e293b;font-weight:500">${fmt(devis.totalHT)} €</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#64748b">Total TVA</td>
            <td style="padding:6px 0;text-align:right;color:#1e293b;font-weight:500">${fmt(devis.totalTVA)} €</td>
          </tr>
          <tr>
            <td style="padding:10px 16px;background:#1e40af;color:#fff;font-weight:700;border-radius:8px 0 0 8px">Total TTC</td>
            <td style="padding:10px 16px;background:#1e40af;color:#fff;font-weight:700;text-align:right;font-size:18px;border-radius:0 8px 8px 0">${fmt(devis.totalTTC)} €</td>
          </tr>
        </table>
      </div>

      ${devis.notes ? `
      <div style="margin-top:32px;padding:16px;background:#f8fafc;border-radius:8px;border-left:3px solid #e2e8f0">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Notes</div>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;white-space:pre-wrap">${devis.notes}</p>
      </div>` : ""}

      <!-- CTA -->
      <div style="margin-top:40px;text-align:center">
        <a href="${pdfUrl}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px">
          Voir le devis complet
        </a>
      </div>

      <p style="margin-top:32px;color:#94a3b8;font-size:13px;line-height:1.6;text-align:center">
        Pour accepter ce devis, veuillez nous contacter ou répondre à cet email.<br>
        Devis valable ${devis.validityDays} jours à compter du ${fmtDate(devis.createdAt)}.
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center">
      <div style="color:#94a3b8;font-size:12px">Envoyé via <strong>Gestly</strong></div>
    </div>
  </div>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>",
      to: devis.client.email,
      subject: `Devis ${devis.number} — ${user.companyName}`,
      html,
    });
  } catch (err) {
    console.error("Resend error:", err);
    return NextResponse.json({ error: "Échec de l'envoi de l'email" }, { status: 500 });
  }

  // Mark as sent if still draft
  const updated = await prisma.devis.update({
    where: { id: params.id },
    data: {
      status: devis.status === "brouillon" ? "envoye" : devis.status,
      sentAt: devis.sentAt ?? new Date(),
    },
    include: { client: true, lines: true },
  });

  return NextResponse.json(updated);
}
