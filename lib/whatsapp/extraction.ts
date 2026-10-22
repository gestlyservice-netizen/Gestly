import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getWhatsappExtractionModel, isAiConfigured } from "@/lib/ai/config";
import { recordAiUsage } from "@/lib/ai/usage";
import type { PendingDevis, RawExtraction } from "@/lib/whatsapp/pending-devis";

// Module isolé : ne dépend ni du webhook, ni de l'orchestrateur, ni d'aucune
// logique métier de devis. Rôle strictement limité à la compréhension du
// langage — JAMAIS la rédaction de la réponse envoyée à l'artisan (ça reste
// déterministe, cf. lib/whatsapp/reply-builder.ts), et jamais d'accès à la
// résolution client (cf. client-resolution.ts). Seule dépendance Prisma
// indirecte : lib/ai/usage.ts, pour enregistrer chaque appel réellement
// effectué (étape 8) — aucune autre écriture en base ici.

const RawLineSchema = z.object({
  ligneCibleIndex: z
    .number()
    .int()
    .nullable()
    .describe("Index de la ligne déjà connue que ce message modifie, ou null si c'est une nouvelle prestation"),
  description: z.string().nullable(),
  quantite: z.number().nullable(),
  unite: z.string().nullable(),
  prixUnitaire: z.number().nullable(),
  montant: z.number().nullable(),
  tva: z
    .number()
    .nullable()
    .describe("Taux de TVA UNIQUEMENT si l'artisan l'a explicitement mentionné, jamais deviné"),
});

export const RawExtractionSchema = z.object({
  intent: z.enum(["devis", "hors_sujet", "annulation", "confirmation", "incomprehensible"]),
  reponseConfirmation: z
    .enum(["oui", "non", "ambigu"])
    .nullable()
    .describe("Renseigné uniquement si intent=\"confirmation\" : le sens de la confirmation. \"ambigu\" si ce n'est pas clairement oui ou non."),
  client: z.object({
    nom: z.string().nullable(),
    telephone: z.string().nullable(),
    email: z.string().nullable(),
    adresse: z.string().nullable(),
  }),
  objet: z.string().nullable(),
  descriptionTravaux: z.string().nullable(),
  // Pas de .default(...) sur ces trois champs (lignes/plusieursDevisDetectes/
  // ambiguites) : découvert en Phase 2 de la validation pré-production
  // (2026-09), un champ avec .default() est généré comme optionnel dans le
  // JSON Schema envoyé au modèle, ce que le mode structured output strict
  // d'OpenAI rejette explicitement ("'required' is required to... including
  // every key in properties"). Tous les champs doivent être listés dans
  // 'required' — un tableau "vide si rien à dire" reste un tableau
  // explicitement requis, jamais un champ optionnel côté schéma API.
  lignes: z.array(RawLineSchema),
  montantMentionne: z
    .object({
      valeur: z.number().nullable(),
      typeExplicite: z.enum(["HT", "TTC"]).nullable(),
    })
    .nullable(),
  notes: z.string().nullable(),
  plusieursDevisDetectes: z.boolean(),
  ambiguites: z.array(z.string()),
});

export class ExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
  }
}

const SYSTEM_PROMPT = `Tu extrais des informations structurées depuis un message WhatsApp d'un artisan français qui décrit un devis à préparer pour Gestly.

RÈGLES STRICTES, JAMAIS D'EXCEPTION :
1. N'INVENTE JAMAIS une donnée absente du message. Un champ non mentionné doit rester null.
2. Ne devine JAMAIS si un montant est HT ou TTC — seulement si l'artisan l'a dit explicitement (typeExplicite null sinon).
3. Ne calcule ni ne déduis aucun prix, quantité ou taux de TVA — reporte uniquement ce qui est dit.
4. Si le message mentionne une ligne déjà connue dans le brouillon actuel (fourni en contexte) pour la corriger ou la compléter, indique ligneCibleIndex avec l'index de cette ligne. Sinon (nouvelle prestation), ligneCibleIndex est null.
5. Si le message contient plusieurs devis différents pour des clients différents, mets plusieursDevisDetectes à true et n'extrais que le premier.
6. Si le message ne concerne pas un devis (question générale, bavardage), intent = "hors_sujet".
7. Si l'artisan semble vouloir annuler/abandonner le brouillon en cours, intent = "annulation".
8. Si le message est une réponse à une question de confirmation (oui/non/ambigu), intent = "confirmation" et renseigne reponseConfirmation :
   - "oui" seulement si la réponse est clairement affirmative et non ambiguë ("oui", "ok", "vas-y", "c'est bon", "confirmé").
   - "non" seulement si la réponse est clairement négative ("non", "annule", "pas encore", "attends").
   - "ambigu" pour tout le reste (silence sur la question, réponse évasive, "peut-être", "je sais pas") — ne jamais forcer oui ou non par défaut.
9. Si le message est illisible ou incompréhensible, intent = "incomprehensible".
10. Sinon, intent = "devis".
11. Liste dans "ambiguites" toute incertitude que tu repères mais NE DOIS PAS trancher toi-même (ex: nom de client qui pourrait désigner deux personnes différentes mentionnées avant).

Réponds uniquement avec la structure demandée, sans texte libre additionnel.`;

export interface ExtractionInput {
  userId: string;
  message: string;
  recentHistory: { direction: "in" | "out"; content: string }[];
  currentPendingDevis: PendingDevis;
}

function buildPrompt(input: ExtractionInput): string {
  const historyText = input.recentHistory
    .slice(-6)
    .map((m) => `${m.direction === "in" ? "Artisan" : "Gestly"}: ${m.content}`)
    .join("\n");

  const currentLines = input.currentPendingDevis.lignes
    .map(
      (l, i) =>
        `  [${i}] ${l.description} — quantité=${l.quantite.value ?? "?"} unité=${l.unite.value ?? "?"} prix unitaire=${l.prixUnitaire.value ?? "?"} montant=${l.montant.value ?? "?"} tva=${l.tva.value ?? "?"}`
    )
    .join("\n") || "  (aucune)";

  return [
    "Brouillon de devis actuel (pour repérer les corrections vs nouvelles infos) :",
    `  Client mentionné: ${input.currentPendingDevis.client.nomMentionne ?? "(aucun)"}`,
    `  Objet: ${input.currentPendingDevis.objet.value ?? "(aucun)"}`,
    "  Lignes:",
    currentLines,
    "",
    "Historique récent de la conversation :",
    historyText || "(début de conversation)",
    "",
    `Nouveau message de l'artisan à analyser :\n${input.message}`,
  ].join("\n");
}

const MAX_ATTEMPTS = 2;

// model : injectable pour les tests (MockLanguageModelV4 de ai/test). En
// production, laissé vide pour utiliser le modèle centralisé configuré dans
// lib/ai/config.ts — l'agent n'a jamais à connaître le nom du modèle.
export async function extractDevisInfo(
  input: ExtractionInput,
  // messageId : uniquement pour rattacher les événements AiUsageEvent
  // générés par CET appel au WhatsappMessage d'origine (étape 8bis) —
  // n'affecte jamais la logique d'extraction elle-même. Le contrôle
  // d'idempotence (ne jamais rappeler le modèle si un résultat existe déjà
  // pour ce message) est fait par l'appelant, cf.
  // lib/whatsapp/extraction-checkpoint.ts — cette fonction reste un simple
  // appel réseau, jamais consciente d'un éventuel résultat déjà en cache.
  opts: { model?: LanguageModel | string; messageId?: string } = {}
): Promise<RawExtraction> {
  if (opts.model === undefined && !isAiConfigured()) {
    // Échoue vite et proprement plutôt que de tenter un appel réseau voué à
    // l'échec (pas de clé) — même esprit que app/api/ai/improve-message.
    throw new ExtractionError("Extraction IA non configurée (aucune clé IA disponible)");
  }

  const model = opts.model ?? getWhatsappExtractionModel();
  const prompt = buildPrompt(input);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await generateObject({
        model,
        schema: RawExtractionSchema,
        system: SYSTEM_PROMPT,
        prompt: attempt === 1 ? prompt : `${prompt}\n\n(Ta réponse précédente n'était pas valide — respecte strictement le format demandé.)`,
      });
      // Un événement par appel réseau réel — cf. lib/ai/usage.ts pour le
      // raisonnement complet sur le comptage retry-safe.
      await recordAiUsage({
        userId: input.userId,
        kind: "extraction",
        success: true,
        inputTokens: result.usage?.inputTokens ?? null,
        outputTokens: result.usage?.outputTokens ?? null,
        messageId: opts.messageId ?? null,
      });
      return result.object as RawExtraction;
    } catch (err) {
      await recordAiUsage({ userId: input.userId, kind: "extraction", success: false, messageId: opts.messageId ?? null });
      lastError = err;
    }
  }

  throw new ExtractionError(
    `Extraction IA échouée après ${MAX_ATTEMPTS} tentative(s)`,
    lastError
  );
}
