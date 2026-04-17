import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PENALITES_DEFAUT =
  "En cas de retard de paiement, une pénalité égale à 3 fois le taux d'intérêt légal sera " +
  "appliquée conformément à l'article L.441-6 du Code de commerce, ainsi qu'une indemnité " +
  "forfaitaire de 40 € pour frais de recouvrement (art. D.441-5).";

const CONDITIONS_DEFAUT = "Règlement à réception de facture.";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const settings = await prisma.settings.findUnique({
      where: { userId: user.id },
    });

    if (!settings) {
      return NextResponse.json({
        companyName:           user.companyName ?? "",
        formeJuridique:        "",
        siret:                 user.siret        ?? "",
        tvaIntracom:           "",
        adresseRue:            user.address      ?? "",
        codePostal:            "",
        ville:                 "",
        telephone:             user.phone        ?? "",
        emailPro:              user.email        ?? "",
        siteWeb:               "",
        logoUrl:               user.logoUrl      ?? "",
        couleurPrincipale:     "#2563EB",
        piedDePage:            "",
        prefixeDevis:          "DEV-",
        prefixeFacture:        "FAC-",
        prochainNumeroDevis:   1,
        prochainNumeroFacture: 1,
        conditionsPaiement:    CONDITIONS_DEFAUT,
        penalitesRetard:       PENALITES_DEFAUT,
        reservePropriete:      false,
      });
    }

    return NextResponse.json(settings);
  } catch (err) {
    console.error("[GET /api/settings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;

    const data = {
      companyName:           String(body.companyName           ?? ""),
      formeJuridique:        body.formeJuridique        ? String(body.formeJuridique)        : null,
      siret:                 body.siret                 ? String(body.siret)                 : null,
      tvaIntracom:           body.tvaIntracom           ? String(body.tvaIntracom)           : null,
      adresseRue:            body.adresseRue            ? String(body.adresseRue)            : null,
      codePostal:            body.codePostal            ? String(body.codePostal)            : null,
      ville:                 body.ville                 ? String(body.ville)                 : null,
      telephone:             body.telephone             ? String(body.telephone)             : null,
      emailPro:              body.emailPro              ? String(body.emailPro)              : null,
      siteWeb:               body.siteWeb               ? String(body.siteWeb)               : null,
      logoUrl:               body.logoUrl               ? String(body.logoUrl)               : null,
      couleurPrincipale:     String(body.couleurPrincipale     ?? "#2563EB"),
      piedDePage:            body.piedDePage            ? String(body.piedDePage)            : null,
      prefixeDevis:          String(body.prefixeDevis          ?? "DEV-"),
      prefixeFacture:        String(body.prefixeFacture        ?? "FAC-"),
      prochainNumeroDevis:   Number(body.prochainNumeroDevis)  || 1,
      prochainNumeroFacture: Number(body.prochainNumeroFacture) || 1,
      conditionsPaiement:    body.conditionsPaiement    ? String(body.conditionsPaiement)    : null,
      penalitesRetard:       body.penalitesRetard       ? String(body.penalitesRetard)       : null,
      reservePropriete:      Boolean(body.reservePropriete),
      updatedAt:             new Date(),
    };

    const settings = await prisma.settings.upsert({
      where:  { userId: user.id },
      create: { id: crypto.randomUUID(), userId: user.id, ...data },
      update: data,
    });

    return NextResponse.json(settings);
  } catch (err) {
    console.error("[POST /api/settings]", err);
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
