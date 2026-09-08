import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getWhatsappExtractionModel, isAiConfigured } from "@/lib/ai/config";
import type { PendingDevis, RawExtraction } from "@/lib/whatsapp/pending-devis";

// Module isolé : ne dépend ni de Prisma, ni du webhook, ni de l'orchestrateur.
// Rôle strictement limité à la compréhension du langage — JAMAIS la
// rédaction de la réponse envoyée à l'artisan (ça reste déterministe,
// cf. lib/whatsapp/reply-builder.ts), et jamais d'accès à la base de
// données (la résolution client se fait ailleurs, cf. client-resolution.ts).

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
  client: z.object({
    nom: z.string().nullable(),
    telephone: z.string().nullable(),
    email: z.string().nullable(),
    adresse: z.string().nullable(),
  }),
  objet: z.string().nullable(),
  descriptionTravaux: z.string().nullable(),
  lignes: z.array(RawLineSchema).default([]),
  montantMentionne: z
    .object({
      valeur: z.number().nullable(),
      typeExplicite: z.enum(["HT", "TTC"]).nullable(),
    })
    .nullable(),
  notes: z.string().nullable(),
  plusieursDevisDetectes: z.boolean().default(false),
  ambiguites: z.array(z.string()).default([]),
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
8. Si le message est une simple confirmation/accord ("oui", "ok", "c'est bon", "vas-y") sans nouvelle information, intent = "confirmation".
9. Si le message est illisible ou incompréhensible, intent = "incomprehensible".
10. Sinon, intent = "devis".
11. Liste dans "ambiguites" toute incertitude que tu repères mais NE DOIS PAS trancher toi-même (ex: nom de client qui pourrait désigner deux personnes différentes mentionnées avant).

Réponds uniquement avec la structure demandée, sans texte libre additionnel.`;

export interface ExtractionInput {
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
  opts: { model?: LanguageModel | string } = {}
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
      return result.object as RawExtraction;
    } catch (err) {
      lastError = err;
    }
  }

  throw new ExtractionError(
    `Extraction IA échouée après ${MAX_ATTEMPTS} tentative(s)`,
    lastError
  );
}
