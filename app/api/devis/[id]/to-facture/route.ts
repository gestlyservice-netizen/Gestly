import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allocateDocumentNumber } from "@/lib/numbering/document-number";

class DevisAlreadyInvoicedError extends Error {}

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
    if (isSubscriptionBlocked(user)) {
      return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
    }

    const devis = await prisma.devis.findFirst({
      where: { id: params.id, userId: user.id },
    });
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 });

    if (devis.status !== "signe") {
      return NextResponse.json(
        { error: "Seul un devis signé peut être transformé en facture" },
        { status: 400 }
      );
    }

    // Transaction unique : réclamation du devis, numéro, création.
    // La réclamation conditionnelle (signé → facturé) garantit qu'un même
    // devis ne produit jamais deux factures, même sur deux clics simultanés :
    // un seul des deux voit encore le devis "signe" au moment de l'UPDATE.
    const facture = await prisma.$transaction(async (tx) => {
      const claim = await tx.devis.updateMany({
        where: { id: devis.id, userId: user.id, status: "signe" },
        data: { status: "facture" },
      });
      if (claim.count !== 1) throw new DevisAlreadyInvoicedError();

      const { number, issuedAt } = await allocateDocumentNumber(tx, "facture", user.id);
      return tx.facture.create({
        data: {
          userId:    user.id,
          clientId:  devis.clientId,
          devisId:   devis.id,
          number,
          createdAt: issuedAt,
          status:    "emise",
          totalHT:   devis.totalHT,
          totalTVA:  devis.totalTVA,
          totalTTC:  devis.totalTTC,
        },
      });
    });

    return NextResponse.json(facture, { status: 201 });
  } catch (err) {
    if (err instanceof DevisAlreadyInvoicedError) {
      return NextResponse.json({ error: "Ce devis a déjà été transformé en facture" }, { status: 409 });
    }
    console.error("[POST /api/devis/:id/to-facture]", err);
    return NextResponse.json({ error: "Erreur lors de la transformation" }, { status: 500 });
  }
}
