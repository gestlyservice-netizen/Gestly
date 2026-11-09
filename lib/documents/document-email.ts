// Contenu et règles communes des emails de devis et de facture
// (app/api/devis/[id]/send, app/api/factures/[id]/send).
//
// Le contenu est construit ici, sans accès réseau ni base : les routes
// l'envoient ensuite par sendEmail() (lib/outbound/email.ts), seul point
// de contact avec Resend, qui respecte OUTBOUND_MODE.
//   - toute donnée saisie (client, lignes, notes, raison sociale) est
//     échappée avant insertion dans le HTML (escapeHtml) ;
//   - le destinataire est validé (parseEmailAddress) ;
//   - les envois sont limités par document et par compte
//     (isDocumentEmailRateLimited).
import { escapeHtml } from "@/lib/email/escape-html";
import { parseEmailAddress } from "@/lib/email/address";
import { isRateLimited } from "@/lib/rate-limit";

const TIME_ZONE = "Europe/Paris";

export const fmtMontant = (n: number) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// « 1,5 » et non « 1.5 » (même règle que le PDF).
export const fmtQuantite = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
// Date affichée au client : jour de Paris (le serveur Vercel est en UTC).
export const fmtDateParis = (d: Date | string) =>
  new Date(d).toLocaleDateString("fr-FR", { timeZone: TIME_ZONE });

/** Expéditeur des emails de documents (domaine vérifié chez Resend en live). */
export function documentEmailFrom(): string {
  return process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>";
}

/** Un objet d'email tient sur une ligne : retours à la ligne et espaces multiples aplatis. */
export function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// Adresse de réponse : l'email professionnel de l'artisan s'il est valide
// (le devis invite le client à « répondre à cet email » : sans elle, la
// réponse partirait vers l'adresse d'expédition de Gestly).
export function replyToFrom(emailPro: string | null | undefined): { replyTo: string } | Record<string, never> {
  const replyTo = parseEmailAddress(emailPro);
  return replyTo ? { replyTo } : {};
}

// ─── Limitation de débit ────────────────────────────────────────────────────
// En mémoire, par instance serverless (voir lib/rate-limit.ts) : protège
// contre les doubles clics, les boucles côté navigateur et l'envoi en rafale
// au même client ; ce n'est pas une garantie distribuée.
export const DOCUMENT_EMAIL_LIMITS = {
  // Même document : 3 envois par tranche de 10 minutes.
  perDocument: { limit: 3, windowMs: 10 * 60 * 1000 },
  // Tous documents d'un compte : 50 envois par heure (facturation de fin de mois).
  perAccount: { limit: 50, windowMs: 60 * 60 * 1000 },
} as const;

export const DOCUMENT_EMAIL_RATE_LIMIT_MESSAGE =
  "Trop d'envois en peu de temps. Patientez quelques minutes avant de renvoyer ce document.";

export function isDocumentEmailRateLimited(
  userId: string,
  kind: "devis" | "facture",
  documentId: string
): boolean {
  const { perDocument, perAccount } = DOCUMENT_EMAIL_LIMITS;
  // Un document bloqué ne consomme pas le quota du compte.
  if (isRateLimited(`document-email:${kind}:${documentId}`, perDocument.limit, perDocument.windowMs)) return true;
  return isRateLimited(`document-email:account:${userId}`, perAccount.limit, perAccount.windowMs);
}

// ─── Devis ──────────────────────────────────────────────────────────────────
export interface DevisEmailInput {
  number: string;
  createdAt: Date;
  validityDays: number;
  notes: string | null;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  lines: { description: string; quantity: number; unitPriceHT: number; tvaRate: number; totalHT: number }[];
  clientName: string;
  companyName: string;
  /** Lien de consultation en ligne du devis (page publique). */
  onlineUrl: string;
}

/** Fin de validité : même calcul que le PDF joint (date du devis + durée). */
export function devisValidUntil(createdAt: Date, validityDays: number): Date {
  const d = new Date(createdAt);
  d.setDate(d.getDate() + validityDays);
  return d;
}

export function devisPdfFilename(number: string): string {
  return `devis-${number}.pdf`;
}

export function buildDevisEmail(input: DevisEmailInput): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  const validUntil = fmtDateParis(devisValidUntil(input.createdAt, input.validityDays));
  const company = e(input.companyName);
  const subject = singleLine(`Devis ${input.number} — ${input.companyName}`);

  const cell = "padding:10px 12px;border-bottom:1px solid #f1f5f9";
  const head = "padding:10px 12px;color:#94a3b8;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0";
  const linesRows = input.lines
    .map(
      (l) => `
      <tr>
        <td style="${cell};color:#334155">${e(l.description)}</td>
        <td style="${cell};color:#64748b;text-align:right">${e(fmtQuantite(l.quantity))}</td>
        <td style="${cell};color:#64748b;text-align:right">${e(fmtMontant(l.unitPriceHT))} €</td>
        <td style="${cell};color:#64748b;text-align:right">${e(fmtQuantite(l.tvaRate))} %</td>
        <td style="${cell};font-weight:600;color:#1e293b;text-align:right">${e(fmtMontant(l.totalHT))} €</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:620px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <div style="background:#1e40af;padding:32px 40px">
      <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px">${company}</div>
      <div style="color:#93c5fd;font-size:13px;margin-top:4px">Devis ${e(input.number)}</div>
    </div>
    <div style="padding:40px">
      <p style="margin:0 0 24px;color:#475569;font-size:15px">
        Bonjour <strong style="color:#1e293b">${e(input.clientName)}</strong>,
      </p>
      <p style="margin:0 0 32px;color:#475569;font-size:15px;line-height:1.6">
        Veuillez trouver ci-joint votre devis <strong>${e(input.number)}</strong> (PDF) pour un montant de
        <strong style="color:#1e40af">${e(fmtMontant(input.totalTTC))} € TTC</strong>,
        valable jusqu'au <strong>${e(validUntil)}</strong>.
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:24px;font-size:13px">
        <thead>
          <tr style="background:#f8fafc">
            <th style="${head};text-align:left">Description</th>
            <th style="${head};text-align:right">Qté</th>
            <th style="${head};text-align:right">Prix HT</th>
            <th style="${head};text-align:right">TVA</th>
            <th style="${head};text-align:right">Total HT</th>
          </tr>
        </thead>
        <tbody>${linesRows}</tbody>
      </table>
      <table cellpadding="0" cellspacing="0" align="right" style="width:240px;font-size:14px">
        <tr>
          <td style="padding:6px 0;color:#64748b">Total HT</td>
          <td style="padding:6px 0;text-align:right;color:#1e293b;font-weight:500">${e(fmtMontant(input.totalHT))} €</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#64748b">Total TVA</td>
          <td style="padding:6px 0;text-align:right;color:#1e293b;font-weight:500">${e(fmtMontant(input.totalTVA))} €</td>
        </tr>
        <tr>
          <td style="padding:10px 16px;background:#1e40af;color:#fff;font-weight:700;border-radius:8px 0 0 8px">Total TTC</td>
          <td style="padding:10px 16px;background:#1e40af;color:#fff;font-weight:700;text-align:right;font-size:18px;border-radius:0 8px 8px 0">${e(fmtMontant(input.totalTTC))} €</td>
        </tr>
      </table>
      <div style="clear:both"></div>
      ${input.notes ? `
      <div style="margin-top:32px;padding:16px;background:#f8fafc;border-radius:8px;border-left:3px solid #e2e8f0">
        <div style="font-size:11px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">Notes</div>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;white-space:pre-wrap">${e(input.notes)}</p>
      </div>` : ""}
      <div style="margin-top:40px;text-align:center">
        <a href="${e(input.onlineUrl)}" style="display:inline-block;background:#1e40af;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px">
          Voir le devis en ligne
        </a>
      </div>
      <p style="margin-top:32px;color:#94a3b8;font-size:13px;line-height:1.6;text-align:center">
        Pour accepter ce devis, veuillez nous contacter ou répondre à cet email.<br>
        Devis valable ${e(input.validityDays)} jours à compter du ${e(fmtDateParis(input.createdAt))}.
      </p>
    </div>
    <div style="background:#f8fafc;padding:20px 40px;border-top:1px solid #e2e8f0;text-align:center">
      <p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:0">
        Vous recevez cet email car <strong>${company}</strong> utilise
        <strong>Gestly</strong> pour vous envoyer ses devis et factures.<br>
        Une question ? Contactez-nous à
        <a href="mailto:contact@gestly.fr" style="color:#94a3b8">contact@gestly.fr</a>.
      </p>
    </div>
  </div>
</body>
</html>`;

  // Version texte (clients de messagerie sans HTML, filtres anti-spam).
  const text = [
    `Bonjour ${input.clientName},`,
    "",
    `Veuillez trouver ci-joint votre devis ${input.number} (PDF) pour un montant de ${fmtMontant(input.totalTTC)} € TTC, valable jusqu'au ${validUntil}.`,
    "",
    `Total HT : ${fmtMontant(input.totalHT)} €`,
    `Total TVA : ${fmtMontant(input.totalTVA)} €`,
    `Total TTC : ${fmtMontant(input.totalTTC)} €`,
    "",
    `Consulter le devis en ligne : ${input.onlineUrl}`,
    "",
    "Pour accepter ce devis, veuillez nous contacter ou répondre à cet email.",
    "",
    input.companyName,
  ].join("\n");

  return { subject, html, text };
}

// ─── Facture ────────────────────────────────────────────────────────────────
export const FACTURE_EMAIL_LIMITS = { subject: 200, message: 10_000 } as const;

export function facturePdfFilename(number: string): string {
  return `facture-${number}.pdf`;
}

export function defaultFactureEmail(input: {
  number: string;
  totalTTC: number;
  clientName: string;
  companyName: string;
}): { subject: string; message: string } {
  return {
    subject: singleLine(`Facture ${input.number} — ${input.companyName}`),
    message:
      `Bonjour ${input.clientName},\n\n` +
      `Veuillez trouver ci-joint votre facture ${input.number} d'un montant de ${fmtMontant(input.totalTTC)} € TTC.\n\n` +
      `Cordialement,\n${input.companyName}`,
  };
}

export type FactureEmailOverrides =
  | { ok: true; to: string | null; subject: string | null; message: string | null }
  | { ok: false; error: string };

// Champs facultatifs saisis dans la fenêtre « Envoyer la facture » : chacun,
// s'il est renseigné, remplace la valeur par défaut. Le destinataire saisi
// doit être UNE adresse valide ; l'objet est ramené sur une ligne.
export function parseFactureEmailOverrides(body: unknown): FactureEmailOverrides {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  for (const key of ["to", "subject", "message"] as const) {
    if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== "string") {
      return { ok: false, error: "Requête invalide" };
    }
  }
  const toRaw = typeof raw.to === "string" ? raw.to.trim() : "";
  const subjectRaw = typeof raw.subject === "string" ? singleLine(raw.subject) : "";
  const messageRaw = typeof raw.message === "string" ? raw.message.trim() : "";

  let to: string | null = null;
  if (toRaw) {
    to = parseEmailAddress(toRaw);
    if (!to) return { ok: false, error: "Adresse email du destinataire invalide (une seule adresse, ex. nom@exemple.fr)" };
  }
  if (subjectRaw.length > FACTURE_EMAIL_LIMITS.subject) {
    return { ok: false, error: `Objet trop long (${FACTURE_EMAIL_LIMITS.subject} caractères maximum)` };
  }
  if (messageRaw.length > FACTURE_EMAIL_LIMITS.message) {
    return { ok: false, error: `Message trop long (${FACTURE_EMAIL_LIMITS.message} caractères maximum)` };
  }
  return { ok: true, to, subject: subjectRaw || null, message: messageRaw || null };
}
