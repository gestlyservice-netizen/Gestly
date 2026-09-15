import type { LanguageModel } from "ai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractDevisInfo, type ExtractionInput } from "@/lib/whatsapp/extraction";
import type { RawExtraction } from "@/lib/whatsapp/pending-devis";
import { getWhatsappExtractionModel } from "@/lib/ai/config";

// Idempotence de l'extraction IA au niveau du WhatsappMessage entrant
// (étape 8bis). Rôle strictement limité à : réclamer atomiquement le droit
// d'appeler le modèle pour CE message, réutiliser un résultat déjà obtenu
// sans jamais rappeler le modèle, et persister le résultat structuré une
// fois obtenu. Jamais de logique métier ici (fusion du brouillon,
// confirmation...) — ça reste le rôle de conversation-turn.ts.
//
// Ne pas confondre avec la conversation multi-tours : la clé du cache est
// l'id du WhatsappMessage, pas la conversation. Un nouveau message entrant
// (nouveau wamid, donc nouvel id) déclenche toujours une nouvelle extraction
// — seul le RETRAITEMENT du même message (retry de job après un échec en
// aval, ex. l'envoi de la réponse) réutilise le résultat déjà obtenu.
//
// Même pattern de réclamation atomique que lib/whatsapp/voice-message.ts,
// lib/whatsapp/job-queue.ts et lib/whatsapp/send-claim.ts : une seule
// requête UPDATE conditionnée, faisant autorité au niveau base de données
// (pas une simple convention applicative) — si deux workers tentent de
// réclamer le même message, un seul voit la ligne encore éligible au moment
// de son UPDATE ; l'autre abandonne sans jamais appeler le modèle.
const STALE_PROCESSING_MS = 5 * 60 * 1000; // aligné sur les autres claims de l'agent

export async function resolveExtractionResult(
  messageId: string,
  input: ExtractionInput,
  opts: { model?: LanguageModel | string } = {}
): Promise<RawExtraction> {
  const current = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: messageId } });

  if (current.extractionStatus === "done" && current.extractionResult) {
    // Checkpoint déjà présent : c'est le cas critique (retry après échec en
    // aval, ex. envoi de la réponse WhatsApp) — aucun appel modèle, aucun
    // second coût IA, on rejoue directement le résultat déjà validé.
    return current.extractionResult as unknown as RawExtraction;
  }

  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
  const claim = await prisma.whatsappMessage.updateMany({
    where: {
      id: messageId,
      OR: [
        { extractionStatus: null },
        { extractionStatus: "processing", updatedAt: { lt: staleBefore } },
      ],
    },
    data: { extractionStatus: "processing" },
  });

  if (claim.count === 0) {
    const fresh = await prisma.whatsappMessage.findUniqueOrThrow({ where: { id: messageId } });
    if (fresh.extractionStatus === "done" && fresh.extractionResult) {
      return fresh.extractionResult as unknown as RawExtraction;
    }
    // "processing" par un autre worker, pas encore périmé : jamais un
    // second appel modèle en parallèle pour ce même message — cette
    // tentative abandonne (le job restera 'failed', reprenable plus tard,
    // par un retry qui retrouvera alors soit le checkpoint terminé, soit un
    // claim redevenu libre).
    throw new Error("Extraction déjà en cours pour ce message (concurrence)");
  }

  let result: RawExtraction;
  try {
    result = await extractDevisInfo(input, { ...opts, messageId });
  } catch (err) {
    // L'appel modèle lui-même a échoué (les MAX_ATTEMPTS internes
    // d'extractDevisInfo sont épuisés) : rien n'a été obtenu, donc rien à
    // checkpointer. On revient à "pas encore extrait" pour permettre un
    // nouvel essai (job-level) plus tard — jamais un état mort.
    await prisma.whatsappMessage.updateMany({
      where: { id: messageId, extractionStatus: "processing" },
      data: { extractionStatus: null },
    });
    throw err;
  }

  // Checkpoint : à partir d'ici l'appel IA a réussi et son coût est déjà
  // engagé. Toute erreur du pipeline APRÈS ce point ne doit plus jamais
  // redéclencher d'appel modèle pour ce message — seule la suite du
  // traitement (fusion, confirmation, envoi...) doit être retentée.
  const modelLabel = typeof opts.model === "string" ? opts.model : opts.model ? "modèle injecté (test)" : getWhatsappExtractionModel();
  await prisma.whatsappMessage.update({
    where: { id: messageId },
    data: {
      extractionStatus: "done",
      extractionResult: result as unknown as Prisma.InputJsonValue,
      extractionModel: modelLabel,
    },
  });

  return result;
}
