import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

// Public read-only endpoint — utilisé par la page d'impression, à la fois
// pour le propriétaire (téléchargement PDF interne) et pour le client final
// (lien partagé). Le CUID agit comme jeton non-devinable.
// L'expiration/révocation du lien ne s'applique jamais au propriétaire.
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // Liste blanche des champs envoyés : la réponse est lisible par toute
    // personne qui a le lien. Jamais le compte de l'artisan (clerkId, email
    // personnel, identifiants et statut Stripe) ni les données de signature.
    const devis = await prisma.devis.findUnique({
      where: { id: params.id },
      select: {
        id: true, number: true, status: true, totalHT: true, totalTVA: true, totalTTC: true,
        validityDays: true, notes: true, createdAt: true, sentAt: true,
        linkRevoked: true, linkExpiresAt: true,
        client: { select: { name: true, email: true, phone: true, address: true } },
        lines: { select: { id: true, description: true, quantity: true, unitPriceHT: true, tvaRate: true, totalHT: true } },
        user: {
          select: {
            clerkId: true,
            settings: {
              select: {
                companyName: true, formeJuridique: true, siret: true, tvaIntracom: true,
                adresseRue: true, codePostal: true, ville: true, telephone: true, emailPro: true,
                siteWeb: true, logoUrl: true, couleurPrincipale: true, piedDePage: true,
                penalitesRetard: true, conditionsPaiement: true, reservePropriete: true,
              },
            },
          },
        },
      },
    });

    if (!devis) {
      return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });
    }

    const { userId: clerkId } = await auth();
    const isOwner = !!clerkId && clerkId === devis.user.clerkId;

    if (!isOwner) {
      if (devis.linkRevoked) {
        return NextResponse.json({ error: "Ce lien a été révoqué" }, { status: 403 });
      }
      if (devis.linkExpiresAt && devis.linkExpiresAt < new Date()) {
        return NextResponse.json({ error: "Ce lien a expiré" }, { status: 403 });
      }
    }

    const { user, ...publicDevis } = devis;
    return NextResponse.json({ ...publicDevis, user: { settings: user.settings } });
  } catch (err) {
    console.error("[GET /api/public/devis/:id]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
