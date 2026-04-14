import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const now          = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      enAttenteCount,
      signesMoisCount,
      caFactureMoisAgg,
      impayesAgg,
      derniersDevis,
      facturesEnAttente,
    ] = await Promise.all([
      // 1. Devis avec statut "envoye" (en attente de réponse)
      prisma.devis.count({
        where: { userId: user.id, status: "envoye" },
      }),

      // 2. Devis signés ce mois
      prisma.devis.count({
        where: { userId: user.id, status: "signe", signedAt: { gte: startOfMonth } },
      }),

      // 3. CA facturé du mois (factures émises ce mois, payées ou non)
      prisma.facture.aggregate({
        where: { userId: user.id, createdAt: { gte: startOfMonth } },
        _sum: { totalTTC: true },
      }),

      // 4. Impayés (factures émises non payées)
      prisma.facture.aggregate({
        where: { userId: user.id, paidAt: null },
        _sum: { totalTTC: true },
      }),

      // 5 derniers devis
      prisma.devis.findMany({
        where:   { userId: user.id },
        orderBy: { createdAt: "desc" },
        take:    5,
        select: {
          id:        true,
          number:    true,
          status:    true,
          totalTTC:  true,
          createdAt: true,
          client:    { select: { name: true } },
        },
      }),

      // Factures non payées (en attente), plus anciennes en premier
      prisma.facture.findMany({
        where:   { userId: user.id, paidAt: null },
        orderBy: { createdAt: "asc" },
        take:    10,
        select: {
          id:        true,
          number:    true,
          totalTTC:  true,
          createdAt: true,
          client:    { select: { name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      stats: {
        enAttenteCount,
        signesMoisCount,
        caFactureMois:  caFactureMoisAgg._sum.totalTTC ?? 0,
        impayesTotal:   impayesAgg._sum.totalTTC       ?? 0,
      },
      derniersDevis,
      facturesEnAttente: facturesEnAttente.map((f) => ({
        ...f,
        joursDepuisEmission: Math.floor(
          (now.getTime() - new Date(f.createdAt).getTime()) / 86_400_000
        ),
      })),
    });
  } catch (err) {
    console.error("[GET /api/dashboard/stats]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
