import * as Sentry from "@sentry/nextjs";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { sendSMS } from "@/lib/sms";
import { getOvhSmsBalance } from "@/lib/ovh-balance";
import { renderMessage } from "./messages";
import { createNotification, createNotificationOnce } from "@/lib/notifications";

const MAX_ATTEMPTS = 5;
const MIN_SMS_CREDITS = 10;

const fmtAmount = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface RelancesSummary {
  usersChecked: number;
  facturesChecked: number;
  sent: number;
  failed: number;
  skipped: number;
}

// Cœur du système de relances automatiques — appelé par le cron quotidien.
// Anti-doublon garanti au niveau base (Relance.@@unique([factureId, niveau, canal])) :
// un même niveau/canal n'est jamais renvoyé une fois marqué "envoyee".
export async function runRelancesCheck(): Promise<RelancesSummary> {
  const summary: RelancesSummary = { usersChecked: 0, facturesChecked: 0, sent: 0, failed: 0, skipped: 0 };

  const allSettings = await prisma.relanceSettings.findMany({ where: { enabled: true } });

  for (const settings of allSettings) {
    summary.usersChecked++;
    const user = await prisma.user.findUnique({ where: { id: settings.userId } });
    if (!user) continue;

    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    const factures = await prisma.facture.findMany({
      where: {
        userId: settings.userId,
        status: { not: "payee" },
        dueDate: { not: null, lt: new Date() },
      },
      include: { client: true, avoirs: { select: { type: true } } },
    });

    let smsBalance: number | null | undefined = undefined; // undefined = pas encore vérifié ce run

    for (const facture of factures) {
      summary.facturesChecked++;

      const hasFullAvoir = facture.avoirs.some((a) => a.type === "total");
      if (hasFullAvoir) {
        summary.skipped++;
        continue;
      }

      const joursRetard = Math.floor((Date.now() - facture.dueDate!.getTime()) / 86_400_000);
      const niveau: 1 | 2 | 3 | 0 =
        joursRetard >= settings.delaiJ3 ? 3 :
        joursRetard >= settings.delaiJ2 ? 2 :
        joursRetard >= settings.delaiJ1 ? 1 : 0;
      if (niveau === 0) continue;

      await createNotificationOnce(
        user.id,
        "facture_en_retard",
        `La facture ${facture.number} est en retard de paiement (${joursRetard} jour(s)).`,
        `/dashboard/factures/${facture.id}`
      );

      const vars = {
        clientName: facture.client.name,
        companyName: user.companyName,
        number: facture.number,
        amount: fmtAmount(facture.totalTTC),
        daysLate: joursRetard,
      };

      const canaux: ("email" | "sms")[] = [];
      if (settings.canalEmail) canaux.push("email");
      if (settings.canalSms) canaux.push("sms");

      for (const canal of canaux) {
        const existing = await prisma.relance.findUnique({
          where: { factureId_niveau_canal: { factureId: facture.id, niveau, canal } },
        });
        if (existing?.statut === "envoyee") continue;
        if (existing && existing.attempts >= MAX_ATTEMPTS) continue;

        if (canal === "email" && !facture.client.email) {
          summary.skipped++;
          continue;
        }
        if (canal === "sms" && !facture.client.phone) {
          summary.skipped++;
          continue;
        }

        try {
          if (canal === "email") {
            if (!resend) throw new Error("RESEND_API_KEY non configurée");
            const message = renderMessage(
              niveau === 1 ? settings.messageJ1 : niveau === 2 ? settings.messageJ2 : settings.messageJ3,
              niveau,
              vars
            );
            await resend.emails.send({
              from: process.env.RESEND_FROM_EMAIL ?? "Gestly <onboarding@resend.dev>",
              to: facture.client.email!,
              subject: `Relance — Facture ${facture.number}`,
              text: message,
            });
          } else {
            if (smsBalance === undefined) {
              try {
                smsBalance = (await getOvhSmsBalance()).creditsLeft;
              } catch {
                smsBalance = null; // SMS non configuré ou API injoignable
              }
            }
            if (smsBalance === null || smsBalance < MIN_SMS_CREDITS) {
              Sentry.captureMessage(
                `[relances] Solde SMS insuffisant pour l'utilisateur ${user.id} — relance niveau ${niveau} facture ${facture.number} non envoyée par SMS`,
                "warning"
              );
              throw new Error("Solde SMS insuffisant");
            }
            const message = renderMessage(
              niveau === 1 ? settings.messageJ1 : niveau === 2 ? settings.messageJ2 : settings.messageJ3,
              niveau,
              vars
            );
            const ok = await sendSMS(facture.client.phone!, message, user.companyName);
            if (!ok) throw new Error("Échec de l'envoi SMS (fournisseur)");
            smsBalance -= 1;
          }

          await prisma.relance.upsert({
            where: { factureId_niveau_canal: { factureId: facture.id, niveau, canal } },
            create: { factureId: facture.id, niveau, canal, statut: "envoyee", attempts: 1 },
            update: { statut: "envoyee", erreur: null, attempts: { increment: 1 }, envoyeeAt: new Date() },
          });
          await createNotification(
            user.id,
            "relance_envoyee",
            `Relance niveau ${niveau} envoyée par ${canal} pour la facture ${facture.number}.`,
            `/dashboard/factures/${facture.id}`
          );
          summary.sent++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await prisma.relance.upsert({
            where: { factureId_niveau_canal: { factureId: facture.id, niveau, canal } },
            create: { factureId: facture.id, niveau, canal, statut: "echec", erreur: msg, attempts: 1 },
            update: { statut: "echec", erreur: msg, attempts: { increment: 1 }, envoyeeAt: new Date() },
          });
          await createNotification(
            user.id,
            "relance_echouee",
            `Échec de la relance niveau ${niveau} par ${canal} pour la facture ${facture.number} : ${msg}`,
            `/dashboard/factures/${facture.id}`
          );
          summary.failed++;
          console.error(`[relances] Échec facture ${facture.id} niveau ${niveau} canal ${canal}:`, msg);
        }
      }
    }
  }

  if (summary.failed > 0) {
    Sentry.captureMessage(`[relances] ${summary.failed} échec(s) sur ${summary.facturesChecked} facture(s) vérifiées`, "warning");
  }

  return summary;
}
