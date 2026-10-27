// Mode des envois sortants (WhatsApp, SMS, emails, IA) — seul endroit qui
// décide si Gestly contacte réellement les services externes.
//
// Règle, dans cet ordre :
//   1. OUTBOUND_MODE=simulate → simulation (coupe-circuit, y compris en
//      production) ; OUTBOUND_MODE=live → envois réels (tests réels
//      contrôlés hors production, uniquement sur décision de l'utilisateur).
//   2. NODE_ENV=development ou test (`next dev`, Vitest) → simulation, même si
//      VERCEL_ENV=production a été importé localement par erreur (ex.
//      `vercel env pull --environment=production`).
//   3. VERCEL_ENV=production → envois réels (production Vercel).
//   4. Sinon → simulation (`next start` local, Preview Vercel...).
// La présence de clés API ne déclenche donc jamais, à elle seule, un envoi.
// Toute valeur inconnue d'OUTBOUND_MODE est ignorée et signalée
// (getOutboundDiagnostics) ; une configuration incohérente en production
// n'est jamais silencieuse (voir plus bas).

export type OutboundMode = "live" | "simulate";

type Env = Record<string, string | undefined>;

function explicitMode(env: Env): OutboundMode | null {
  const explicit = env.OUTBOUND_MODE?.trim().toLowerCase();
  return explicit === "simulate" || explicit === "live" ? explicit : null;
}

export function getOutboundMode(env: Env = process.env): OutboundMode {
  const explicit = explicitMode(env);
  if (explicit) return explicit;
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test") return "simulate";
  return env.VERCEL_ENV === "production" ? "live" : "simulate";
}

export interface OutboundDiagnostics {
  mode: OutboundMode;
  // Problèmes de configuration à signaler bruyamment (log d'erreur, Sentry,
  // /api/health en échec). Vide si la configuration est cohérente.
  problems: string[];
  // Informations utiles mais attendues (ex. simulation sur Preview).
  notes: string[];
}

// Production "probable" malgré l'absence de VERCEL_ENV=production : build de
// production exécuté sur Vercel, ou URL publique de production configurée.
function looksLikeProduction(env: Env): boolean {
  if (env.NODE_ENV !== "production") return false;
  if (env.VERCEL_ENV === "preview" || env.VERCEL_ENV === "development") return false;
  const appUrl = env.APP_URL ?? "";
  return env.VERCEL === "1" || (/gestly\.fr/i.test(appUrl) && !/localhost/i.test(appUrl));
}

export function getOutboundDiagnostics(env: Env = process.env): OutboundDiagnostics {
  const mode = getOutboundMode(env);
  const explicit = explicitMode(env);
  const raw = env.OUTBOUND_MODE?.trim();
  const problems: string[] = [];
  const notes: string[] = [];

  if (raw && !explicit) {
    problems.push(`OUTBOUND_MODE="${raw}" non reconnu (valeurs : simulate, live) — ignoré`);
  }
  if (isOutboundDisabled(env)) {
    // Choix délibéré (bêta privée), visible par l'artisan : voir isOutboundDisabled.
    notes.push("Bêta privée (OUTBOUND_MODE=simulate en production) : AUCUN envoi réel ; les envois demandés par l'artisan sont refusés avec un message");
  }
  if (mode === "simulate" && env.VERCEL_ENV === "production" && !explicit && (env.NODE_ENV === "development" || env.NODE_ENV === "test")) {
    notes.push(`VERCEL_ENV=production ignoré car NODE_ENV=${env.NODE_ENV} : simulation`);
  }
  if (mode === "simulate" && !explicit && env.VERCEL_ENV !== "production" && looksLikeProduction(env)) {
    problems.push(
      "Production probable (build de production sur Vercel ou APP_URL de production) mais VERCEL_ENV≠production : " +
        "envois en SIMULATION. Exposer les variables système Vercel ou définir OUTBOUND_MODE=live"
    );
  }
  if (mode === "live" && env.VERCEL_ENV !== "production") {
    notes.push("OUTBOUND_MODE=live hors production : envois RÉELS");
  }
  if (mode === "simulate" && env.VERCEL_ENV === "preview") {
    notes.push("Preview Vercel : envois simulés");
  }

  return { mode, problems, notes };
}

export function isOutboundSimulated(env: Env = process.env): boolean {
  return getOutboundMode(env) === "simulate";
}

// Bêta privée : simulation volontaire sur le déploiement de production.
// Les envois demandés par l'artisan (devis, facture, relances) sont alors
// REFUSÉS au lieu d'être simulés : un devis marqué « envoyé » qui n'est
// jamais parti tromperait l'artisan et son client. En local et sur Preview,
// la simulation reste silencieuse pour permettre de tester les parcours.
export function isOutboundDisabled(env: Env = process.env): boolean {
  return explicitMode(env) === "simulate" && env.VERCEL_ENV === "production";
}

export const OUTBOUND_DISABLED_MESSAGE =
  "Bêta privée : l'envoi automatique (email, WhatsApp, SMS) est désactivé. " +
  "Téléchargez le PDF (ou copiez le lien du devis) et envoyez-le vous-même.";

export type OutboundChannel =
  | "whatsapp.text"
  | "whatsapp.template"
  | "whatsapp.document"
  | "whatsapp.media_upload"
  | "whatsapp.media_download"
  | "sms"
  | "sms.balance"
  | "email"
  | "ai";

export interface SimulatedOutboundEntry {
  channel: OutboundChannel;
  to: string | null;
  summary: string;
  at: Date;
}

// Journal en mémoire des envois simulés (100 derniers) : permet aux tests de
// prouver qu'un envoi a été intercepté, et au développeur de les inspecter.
// Jamais persisté, jamais exposé par une route.
const MAX_ENTRIES = 100;
const outbox: SimulatedOutboundEntry[] = [];

export function getSimulatedOutbox(): readonly SimulatedOutboundEntry[] {
  return outbox;
}

export function clearSimulatedOutbox(): void {
  outbox.length = 0;
}

// Masque un destinataire dans les logs : on garde de quoi reconnaître un
// numéro ou une adresse de test, jamais la donnée complète.
export function maskRecipient(to: string | null | undefined): string | null {
  if (!to) return null;
  if (to.includes("@")) {
    const [local, domain] = to.split("@");
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return to.length > 4 ? `${"*".repeat(to.length - 4)}${to.slice(-4)}` : "****";
}

export function recordSimulatedOutbound(
  channel: OutboundChannel,
  to: string | null | undefined,
  summary: string
): void {
  const entry: SimulatedOutboundEntry = { channel, to: maskRecipient(to), summary, at: new Date() };
  outbox.push(entry);
  if (outbox.length > MAX_ENTRIES) outbox.shift();
  const line = `[outbound:simulate] ${channel} to=${entry.to ?? "-"} ${summary}`;
  // Un envoi bloqué alors que la configuration semble être celle de la
  // production est une anomalie : journalisé en erreur, jamais en silence.
  if (getOutboundDiagnostics().problems.length > 0) console.error(`${line} — ENVOI NON EFFECTUÉ (configuration incohérente)`);
  else console.info(line);
}

export function simulatedId(prefix: string): string {
  return `sim_${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
