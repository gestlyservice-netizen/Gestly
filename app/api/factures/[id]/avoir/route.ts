import { NextResponse } from "next/server";
import { getCurrentUser, isSubscriptionBlocked } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { allocateDocumentNumber } from "@/lib/numbering/document-number";

// Un avoir corrige une facture SANS jamais la modifier ni la supprimer —
// seule voie légale de correction d'une facture déjà émise en France.

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

  const facture = await prisma.facture.findFirst({ where: { id: params.id, userId: user.id } });
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const avoirs = await prisma.avoir.findMany({
    where: { factureId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(avoirs);
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  if (isSubscriptionBlocked(user)) {
    return NextResponse.json({ error: "Abonnement inactif ou impayé" }, { status: 402 });
  }

  const facture = await prisma.facture.findFirst({
    where: { id: params.id, userId: user.id },
    include: { lines: true, devis: { include: { lines: true } } },
  });
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload invalide" }, { status: 400 });
  }
  const { type, reason, description, unitPriceHT, tvaRate } = body as Record<string, unknown>;

  if (typeof reason !== "string" || !reason.trim()) {
    return NextResponse.json({ error: "La raison de l'avoir est obligatoire" }, { status: 400 });
  }
  const avoirType = type === "partiel" ? "partiel" : "total";

  let lines: { description: string; quantity: number; unitPriceHT: number; tvaRate: number; totalHT: number }[];
  if (avoirType === "total") {
    const sourceLines = facture.lines.length > 0 ? facture.lines : facture.devis?.lines ?? [];
    lines = sourceLines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPriceHT: l.unitPriceHT,
      tvaRate: l.tvaRate,
      totalHT: l.totalHT,
    }));
    if (lines.length === 0) {
      return NextResponse.json({ error: "Aucune ligne à créditer sur cette facture" }, { status: 400 });
    }
  } else {
    const ht = Number(unitPriceHT);
    const tva = Number(tvaRate);
    if (!description || typeof description !== "string" || !description.trim()) {
      return NextResponse.json({ error: "Description requise pour un avoir partiel" }, { status: 400 });
    }
    if (!Number.isFinite(ht) || ht <= 0) {
      return NextResponse.json({ error: "Montant HT invalide" }, { status: 400 });
    }
    lines = [{
      description: description.trim(),
      quantity: 1,
      unitPriceHT: ht,
      tvaRate: Number.isFinite(tva) ? tva : 20,
      totalHT: ht,
    }];
  }

  const totalHT = lines.reduce((s, l) => s + l.totalHT, 0);
  const totalTVA = lines.reduce((s, l) => s + (l.totalHT * l.tvaRate) / 100, 0);
  const totalTTC = totalHT + totalTVA;

  // Une seule transaction : numéro (sous verrou par artisan, ce qui
  // sérialise aussi les avoirs concurrents sur une même facture), contrôle
  // du montant déjà crédité, création. En cas de refus, rien n'est créé et
  // aucun numéro n'est consommé.
  try {
    const avoir = await prisma.$transaction(async (tx) => {
      const { number, issuedAt } = await allocateDocumentNumber(tx, "avoir", user.id);

      const previous = await tx.avoir.findMany({ where: { factureId: facture.id, userId: user.id }, select: { totalTTC: true } });
      const alreadyCredited = previous.reduce((s, a) => s + a.totalTTC, 0);
      const remaining = facture.totalTTC - alreadyCredited;
      if (avoirType === "total" && previous.length > 0) {
        throw new AvoirRuleError(
          "Cette facture a déjà fait l'objet d'un avoir : créez un avoir partiel pour le solde restant."
        );
      }
      if (totalTTC > remaining + CENT_TOLERANCE) {
        throw new AvoirRuleError(
          `Le montant de l'avoir (${totalTTC.toFixed(2)} € TTC) dépasse le montant restant à créditer sur la facture (${Math.max(0, remaining).toFixed(2)} € TTC).`
        );
      }

      return tx.avoir.create({
        data: {
          userId: user.id,
          factureId: facture.id,
          clientId: facture.clientId,
          number,
          createdAt: issuedAt,
          type: avoirType,
          reason: reason.trim(),
          totalHT,
          totalTVA,
          totalTTC,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });
    return NextResponse.json(avoir, { status: 201 });
  } catch (err) {
    if (err instanceof AvoirRuleError) return NextResponse.json({ error: err.message }, { status: 409 });
    throw err;
  }
}

// Un avoir ne peut jamais créditer plus que ce qui a été facturé (somme
// des avoirs ≤ total TTC de la facture), à l'arrondi du centime près.
const CENT_TOLERANCE = 0.005;

class AvoirRuleError extends Error {}
