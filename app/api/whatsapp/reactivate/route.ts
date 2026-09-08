import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { enableArtisanBotForUser } from "@/lib/whatsapp/artisan-optout";

// Affordance minimale pour une réactivation de l'assistant WhatsApp depuis
// les paramètres Gestly (étape 8, mécanisme 1), indépendante du mot-clé
// START envoyé depuis WhatsApp lui-même. Pas encore reliée à une interface
// dédiée — prête à être appelée par un futur bouton "Réactiver l'assistant
// WhatsApp" dans /dashboard/parametres.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const reactivated = await enableArtisanBotForUser(user.id);
  return NextResponse.json({ reactivated });
}
