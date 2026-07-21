import { NextResponse } from "next/server";
import { generateText } from "ai";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { isAiConfigured } from "@/lib/ai/config";

// Amélioration de message côté serveur uniquement — aucune clé exposée au
// client. Désactivée tant qu'aucun fournisseur IA n'est configuré (voir
// GET ci-dessous, utilisé par l'UI pour masquer le bouton le cas échéant).
export async function GET() {
  return NextResponse.json({ configured: isAiConfigured() });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }
  if (!isAiConfigured()) {
    return NextResponse.json({ error: "Fonctionnalité IA non configurée" }, { status: 503 });
  }

  const body: unknown = await request.json().catch(() => null);
  const draft = body && typeof body === "object" ? (body as Record<string, unknown>).draft : undefined;
  if (typeof draft !== "string" || !draft.trim()) {
    return NextResponse.json({ error: "Message vide" }, { status: 400 });
  }
  // Ne transmet que le texte du message — aucune autre donnée client
  // (montants, coordonnées, historique) n'est envoyée au prestataire IA.
  if (draft.length > 2000) {
    return NextResponse.json({ error: "Message trop long" }, { status: 400 });
  }

  try {
    const { text } = await generateText({
      model: "openai/gpt-4o-mini",
      system:
        "Tu aides un artisan français à rédiger des messages professionnels et courtois à destination de ses clients (devis, relances de factures). Réponds uniquement avec le message amélioré, sans commentaire ni guillemets, en conservant les variables entre accolades telles quelles (ex: {clientName}).",
      prompt: `Améliore ce message pour qu'il soit clair, professionnel et courtois, en conservant son sens et sa longueur approximative :\n\n${draft}`,
    });
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    console.error("[POST /api/ai/improve-message]", err);
    return NextResponse.json({ error: "Erreur du service IA" }, { status: 502 });
  }
}
