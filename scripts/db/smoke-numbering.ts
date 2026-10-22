// Test de fumée de la numérotation sur la VRAIE base, après les migrations
// de numérotation (phase B du plan). Exécute le code applicatif réel
// (createDevis, allocateDocumentNumber, applyRequestedNext) dans UNE
// transaction annulée à la fin : aucune donnée ne reste en base.
//
//   powershell -ExecutionPolicy Bypass -File scripts\db\smoke-numbering.ps1
//
// Données créées dans la transaction : un client fictif (sans téléphone ni
// email), deux devis, une facture et un avoir — tous annulés.
import { prisma } from "@/lib/prisma";
import { createDevis } from "@/lib/devis/create-devis";
import {
  allocateDocumentNumber,
  applyRequestedNext,
  countersAvailable,
  readSeriesState,
  NextNumberError,
} from "@/lib/numbering/document-number";

class Rollback extends Error {}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function counts() {
  const [devis, factures, avoirs, clients, compteurs] = await Promise.all([
    prisma.devis.count(),
    prisma.facture.count(),
    prisma.avoir.count(),
    prisma.client.count(),
    prisma.documentNumberCounter.count(),
  ]);
  return { devis, factures, avoirs, clients, compteurs };
}

async function main() {
  const before = await counts();
  const owner = await prisma.facture.findFirst({ select: { userId: true } });
  if (!owner) throw new Error("Aucune facture en base : compte de test introuvable.");
  const userId = owner.userId;
  const year = new Date().getFullYear();

  try {
    await prisma.$transaction(
      async (tx) => {
        check("table des compteurs détectée", await countersAvailable(tx));
        const settings = await tx.settings.findUnique({ where: { userId } });

        const initial = await readSeriesState(tx, "devis", userId, settings);
        check("série annuelle par défaut", initial.series.prefix === `DEV-${year}-`, initial.series.prefix);

        const client = await tx.client.create({ data: { userId, name: "Client fictif (test de fumée)" } });
        const line = { description: "Prestation fictive", quantity: 1, unitPriceHT: 100, tvaRate: 20 };
        const d1 = await createDevis({ userId, clientId: client.id, lines: [line] }, tx);
        const d2 = await createDevis({ userId, clientId: client.id, lines: [line] }, tx);
        const n = initial.next;
        const fmt = (p: string, s: number) => `${p}${String(s).padStart(3, "0")}`;
        check("1er devis = Prochain n° affiché", d1.number === fmt(`DEV-${year}-`, n), d1.number);
        check("2e devis consécutif", d2.number === fmt(`DEV-${year}-`, n + 1), d2.number);
        check("date d'émission croissante", d2.createdAt >= d1.createdAt);

        const counter = await tx.documentNumberCounter.findUnique({
          where: { userId_kind_series: { userId, kind: "devis", series: `DEV-${year}-` } },
        });
        check("compteur persistant créé", counter?.nextValue === n + 2, `nextValue=${counter?.nextValue}`);

        await tx.devisLine.deleteMany({ where: { devisId: d2.id } });
        await tx.devis.delete({ where: { id: d2.id } });
        const afterDelete = await readSeriesState(tx, "devis", userId, settings);
        check("numéro supprimé jamais réattribué (D4)", afterDelete.next === n + 2, `next=${afterDelete.next}`);

        const numbering = {
          prefixeDevis: settings?.prefixeDevis ?? "DEV-",
          prefixeFacture: settings?.prefixeFacture ?? "FAC-",
          prochainNumeroDevis: settings?.prochainNumeroDevis ?? 1,
          prochainNumeroFacture: settings?.prochainNumeroFacture ?? 1,
        };
        let refused = false;
        try {
          await applyRequestedNext(tx, "devis", userId, numbering, n);
        } catch (err) {
          refused = err instanceof NextNumberError;
        }
        check("« Prochain n° » inférieur refusé", refused);
        // Le refus est levé avant toute écriture : la transaction reste utilisable.
        await applyRequestedNext(tx, "devis", userId, numbering, n + 10);
        const d3 = await createDevis({ userId, clientId: client.id, lines: [line] }, tx);
        check("« Prochain n° » supérieur appliqué", d3.number === fmt(`DEV-${year}-`, n + 10), d3.number);

        const factureState = await readSeriesState(tx, "facture", userId, settings);
        const f = await allocateDocumentNumber(tx, "facture", userId);
        check("facture : série annuelle", f.number === fmt(`FAC-${year}-`, factureState.next), f.number);
        const a = await allocateDocumentNumber(tx, "avoir", userId);
        check("avoir : série AV annuelle", a.number.startsWith(`AV-${year}-`), a.number);

        throw new Rollback();
      },
      { timeout: 60_000, maxWait: 15_000 }
    );
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }

  const after = await counts();
  check("transaction annulée : base inchangée", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
  console.log(failures === 0 ? "SMOKE NUMÉROTATION OK" : `SMOKE NUMÉROTATION : ${failures} échec(s)`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error("Erreur :", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
