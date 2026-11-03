import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { canSendEmail, sendEmail } from "@/lib/outbound/email";
import { isOutboundDisabled } from "@/lib/outbound/mode";
import { prisma } from "@/lib/prisma";
import { isSubscriptionBlocked } from "@/lib/auth";
import { sendSMS } from "@/lib/sms";
import { getOvhSmsBalance } from "@/lib/ovh-balance";
import { renderMessage } from "./messages";
import { factureBalance } from "@/lib/factures/balance";
import { joursDeRetard } from "@/lib/factures/echeance";
import { createNotification, createNotificationOnce } from "@/lib/notifications";

const MAX_ATTEMPTS = 5;
const MIN_SMS_CREDITS = 10;
// Réservation restée « en_cours » (exécution interrompue en plein envoi) :
// reprise au-delà de ce délai.
const STALE_CLAIM_MS = 60 * 60_000;

type Canal = "email" | "sms";

// Réserve l'envoi (facture, niveau, canal) AVANT d'envoyer : la ligne Relance
// passe à « en_cours » par une écriture atomique (création protégée par
// l'unicité factureId+niveau+canal, ou mise à jour conditionnelle d'un échec).
// Deux exécutions simultanées du cron (Vercel peut livrer un cron deux fois,
// ou l'administrateur le lancer en même temps) ne peuvent donc plus envoyer
// deux fois la même relance. Avant : lecture puis envoi puis écriture, les
// deux exécutions envoyaient.
async function claimRelance(factureId: string, niveau: number, canal: Canal): Promise<boolean> {
  const key = { factureId_niveau_canal: { factureId, niveau, canal } };
  const existing = await prisma.relance.findUnique({ where: key });
  if (!existing) {
    try {
      await prisma.relance.create({ data: { factureId, niveau, canal, statut: "en_cours", attempts: 0, envoyeeAt: new Date() } });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // réservée par une autre exécution
      throw err;
    }
  }
  if (existing.statut === "envoyee" || existing.attempts >= MAX_ATTEMPTS) return false;
  const stale = existing.statut === "en_cours" && existing.envoyeeAt.getTime() < Date.now() - STALE_CLAIM_MS;
  if (existing.statut !== "echec" && !stale) return false;
  const { count } = await prisma.relance.updateMany({
    where: { id: existing.id, statut: existing.statut, attempts: existing.attempts, envoyeeAt: existing.envoyeeAt },
    data: { statut: "en_cours", envoyeeAt: new Date() },
  });
  return count === 1;
}

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
// chaque envoi est réservé avant d'être tenté (claimRelance), et un même
// niveau/canal n'est jamais renvoyé une fois marqué "envoyee".
export async function runRelancesCheck(): Promise<RelancesSummary> {
  const summary: RelancesSummary = { usersChecked: 0, facturesChecked: 0, sent: 0, failed: 0, skipped: 0 };

  // Bêta privée : aucune relance n'est simulée ni enregistrée, pour qu'elles
  // partent normalement le jour où les envois réels sont activés.
  if (isOutboundDisabled()) return summary;

  const allSettings = await prisma.relanceSettings.findMany({ where: { enabled: true } });

  for (const settings of allSettings) {
    summary.usersChecked++;
    // Une erreur sur un compte (base, données inattendues) ne prive plus les
    // comptes suivants de leurs relances : elle est journalisée et comptée.
    try {
      await relancerCompte(settings, summary);
    } catch (err) {
      summary.failed++;
      console.error(`[relances] Échec du traitement du compte ${settings.userId}:`, err);
      Sentry.captureException(err);
    }
  }

  if (summary.failed > 0) {
    Sentry.captureMessage(`[relances] ${summary.failed} échec(s) sur ${summary.facturesChecked} facture(s) vérifiées`, "warning");
  }

  return summary;
}

type RelanceSettingsRow = Awaited<ReturnType<typeof prisma.relanceSettings.findMany>>[number];

async function relancerCompte(settings: RelanceSettingsRow, summary: RelancesSummary): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: settings.userId } });
  // Abonnement résilié ou impayé : plus aucune relance (emails et SMS à la charge de Gestly).
  if (!user || isSubscriptionBlocked(user)) return;

  const emailEnabled = canSendEmail();

  const factures = await prisma.facture.findMany({
    where: {
      userId: settings.userId,
      status: { not: "payee" },
      // Les anciennes factures sans échéance ne sont jamais relancées
      // (décision utilisateur, 2026-11-03) ; les nouvelles en ont toujours une.
      dueDate: { not: null, lt: new Date() },
    },
    include: { client: true, avoirs: { select: { totalTTC: true } } },
  });

  let smsBalance: number | null | undefined = undefined; // undefined = pas encore vérifié ce run

  for (const facture of factures) {
    summary.facturesChecked++;

    // Soldée par avoir (avoir total, ou partiels couvrant tout le TTC) : plus
    // rien à réclamer. Sinon, on ne réclame que le reste dû.
    const { outstanding } = factureBalance(facture);
    if (outstanding <= 0) {
      summary.skipped++;
      continue;
    }

    // Même calcul que l'affichage « En retard » (lib/factures/echeance.ts).
    // Activation tardive (décision utilisateur, 2026-11-03) : seul le niveau
    // atteint est envoyé, sans rattrapage des niveaux précédents.
    const joursRetard = joursDeRetard(facture.dueDate, new Date()) ?? 0;
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
      amount: fmtAmount(outstanding),
      daysLate: joursRetard,
    };

    const canaux: ("email" | "sms")[] = [];
    if (settings.canalEmail) canaux.push("email");
    if (settings.canalSms) canaux.push("sms");

    for (const canal of canaux as Canal[]) {
      if (canal === "email" && !facture.client.email) {
        summary.skipped++;
        continue;
      }
      if (canal === "sms" && !facture.client.phone) {
        summary.skipped++;
        continue;
      }
      // Déjà envoyée, abandonnée après MAX_ATTEMPTS, ou en cours ailleurs.
      if (!(await claimRelance(facture.id, niveau, canal))) continue;
      const key = { factureId_niveau_canal: { factureId: facture.id, niveau, canal } };

      try {
        if (canal === "email") {
          if (!emailEnabled) throw new Error("RESEND_API_KEY non configurée");
          const message = renderMessage(
            niveau === 1 ? settings.messageJ1 : niveau === 2 ? settings.messageJ2 : settings.messageJ3,
            niveau,
            vars
          );
          // Lève une exception si Resend refuse l'email → relance "echec".
          await sendEmail({
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

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await prisma.relance.update({
          where: key,
          data: { statut: "echec", erreur: msg, attempts: { increment: 1 }, envoyeeAt: new Date() },
        });
        await createNotification(
          user.id,
          "relance_echouee",
          `Échec de la relance niveau ${niveau} par ${canal} pour la facture ${facture.number} : ${msg}`,
          `/dashboard/factures/${facture.id}`
        );
        summary.failed++;
        console.error(`[relances] Échec facture ${facture.id} niveau ${niveau} canal ${canal}:`, msg);
        continue;
      }

      // Hors du try : un incident après l'envoi (enregistrement, notification)
      // ne doit jamais faire passer la relance en « echec », ce qui la
      // renverrait au client au passage suivant.
      await prisma.relance.update({
        where: key,
        data: { statut: "envoyee", erreur: null, attempts: { increment: 1 }, envoyeeAt: new Date() },
      });
      await createNotification(
        user.id,
        "relance_envoyee",
        `Relance niveau ${niveau} envoyée par ${canal} pour la facture ${facture.number}.`,
        `/dashboard/factures/${facture.id}`
      );
      summary.sent++;
    }
  }
}
