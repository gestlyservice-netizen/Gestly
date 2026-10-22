import { Resend } from "resend";
import { isOutboundSimulated, recordSimulatedOutbound, simulatedId } from "@/lib/outbound/mode";

// Seul point de création d'un client Resend dans l'application.
//   - mode "live"     : vrai client Resend, construit comme avant
//                       (`new Resend(process.env.RESEND_API_KEY)`) ;
//   - mode "simulate" : client simulé, aucun appel réseau, même si
//                       RESEND_API_KEY est définie.
//
// Les appelants utilisent sendEmail(), jamais client.emails.send()
// directement : le SDK Resend NE LÈVE PAS d'exception quand l'API refuse un
// email (domaine non vérifié, quota, adresse invalide...) — il renvoie
// `{ data: null, error }`. sendEmail() transforme ce cas en exception, pour
// qu'un échec ne soit jamais traité comme un envoi réussi.

type SendFn = Resend["emails"]["send"];
export type EmailPayload = Parameters<SendFn>[0];
type SendResult = Awaited<ReturnType<SendFn>>;

export interface EmailClient {
  emails: { send: (payload: EmailPayload) => Promise<SendResult> };
}

export class EmailSendError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

function recipients(to: EmailPayload["to"]): string {
  return Array.isArray(to) ? to.join(",") : String(to ?? "");
}

const simulatedClient: EmailClient = {
  emails: {
    async send(payload) {
      const attachments = "attachments" in payload && payload.attachments ? payload.attachments.length : 0;
      recordSimulatedOutbound(
        "email",
        recipients(payload.to),
        `subject="${payload.subject ?? ""}" attachments=${attachments}`
      );
      return { data: { id: simulatedId("email") }, error: null, headers: null } as SendResult;
    },
  },
};

export function getEmailClient(): EmailClient {
  if (isOutboundSimulated()) return simulatedClient;
  return new Resend(process.env.RESEND_API_KEY);
}

// Envoie un email et renvoie l'identifiant Resend. Lève EmailSendError si
// Resend renvoie une erreur ou aucun identifiant ; les erreurs réseau du SDK
// sont propagées telles quelles. Dans tous les cas, un échec est une
// exception : l'appelant ne doit marquer un document "envoyé" qu'après le
// retour normal de cette fonction.
export async function sendEmail(payload: EmailPayload): Promise<{ id: string }> {
  const result = await getEmailClient().emails.send(payload);
  if (result.error) {
    const { message, name } = result.error as { message?: string; name?: string };
    throw new EmailSendError(`Resend a refusé l'email : ${message ?? "erreur inconnue"}`, name);
  }
  if (!result.data?.id) {
    throw new EmailSendError("Resend n'a renvoyé aucun identifiant d'email");
  }
  return { id: result.data.id };
}

// Vrai si un envoi d'email peut être tenté : toujours en simulation (aucune
// clé requise), sinon seulement si RESEND_API_KEY est définie — même règle
// qu'avant pour le mode live.
export function canSendEmail(): boolean {
  return isOutboundSimulated() || !!process.env.RESEND_API_KEY;
}
