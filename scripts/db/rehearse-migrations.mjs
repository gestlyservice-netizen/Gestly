// Répétition LOCALE des migrations de numérotation sur un vrai moteur
// PostgreSQL 17 (PGlite, en mémoire). N'ouvre AUCUNE connexion réseau et
// n'accepte aucune URL de base : il est impossible de viser Supabase avec
// ce script. Rien n'est écrit sur disque.
//
//   node scripts/db/rehearse-migrations.mjs
//
// 1. Reconstruit le schéma public réel à partir du catalogue lu en lecture
//    seule (scripts/db/fixtures/catalog-20261022.txt) et vérifie que la
//    copie est identique à la base (instantané snapshot-20261022.txt).
// 2. Insère des données SYNTHÉTIQUES de même forme que les données réelles
//    (8 devis, 13 lignes, 5 factures sans ligne propre, 1 devis « signe »
//    déjà facturé, 0 avoir).
// 3. Applique les migrations 1 → 4, contrôle le schéma (0 écart), le
//    postcheck, les tests de comportement, la relance de la migration 4,
//    l'atomicité en cas d'échec, les garde-fous de retour arrière, le retour
//    arrière complet (schéma identique à l'original), puis la ré-application.
// Le dépendance @electric-sql/pglite est fournie par prisma (@prisma/dev).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, parseSnapshot } from "./compare-schema.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIG = join(REPO, "prisma/manual-migrations");
const FIX = join(REPO, "scripts/db/fixtures");
const read = (p) => readFileSync(p, "utf8");
const migration = (name) => read(join(MIG, name));

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

// ── Schéma réel reconstruit depuis le catalogue ────────────────────────────
function ddlFromCatalog(text) {
  const lines = text.split(/\r?\n/).filter((l) => /^[AKXR]\|/.test(l));
  const tables = new Map();
  for (const l of lines.filter((l) => l.startsWith("A|"))) {
    const [, table, ord, col, type, notnull, ...def] = l.split("|");
    const d = def.join("|");
    if (!tables.has(table)) tables.set(table, []);
    tables.get(table).push({ ord, sql: `"${col}" ${type}${notnull === "true" ? " NOT NULL" : ""}${d ? ` DEFAULT ${d}` : ""}` });
  }
  const out = [];
  for (const [table, cols] of tables) {
    out.push(`CREATE TABLE "${table}" (${cols.sort((a, b) => a.ord.localeCompare(b.ord)).map((c) => c.sql).join(", ")});`);
  }
  const constraints = lines.filter((l) => l.startsWith("K|")).map((l) => l.split("|")).sort((a, b) => a[1].localeCompare(b[1]));
  for (const [, , table, name, ...def] of constraints) out.push(`ALTER TABLE ${table} ADD CONSTRAINT "${name}" ${def.join("|")};`);
  for (const l of lines.filter((l) => l.startsWith("X|"))) out.push(`${l.slice(2)};`);
  for (const l of lines.filter((l) => l.startsWith("R|"))) out.push(`ALTER TABLE "${l.slice(2)}" ENABLE ROW LEVEL SECURITY;`);
  return out.join("\n");
}

// ── Données synthétiques (aucune donnée réelle) ────────────────────────────
const SEED = `
INSERT INTO "User" ("id","clerkId","email","companyName") VALUES
  ('u1','clerk_u1','artisan@example.invalid','Artisan Test'),
  ('u2','clerk_u2','vide@example.invalid','Compte sans document');
INSERT INTO "Settings" ("id","userId","updatedAt") VALUES ('s1','u1',now());
INSERT INTO "Client" ("id","userId","name") VALUES ('c1','u1','Client A'),('c2','u1','Client B'),('c3','u1','Client C');
INSERT INTO "Devis" ("id","userId","clientId","number","status","totalHT","totalTVA","totalTTC","sentAt","signedAt") VALUES
  ('d1','u1','c1','DEV-2026-001','signe',  300,60,360, now(),now()),
  ('d2','u1','c1','DEV-2026-002','facture',100,20,120, now(),now()),
  ('d3','u1','c2','DEV-2026-003','paye',   200,40,240, now(),now()),
  ('d4','u1','c2','DEV-2026-004','paye',   200,40,240, now(),now()),
  ('d5','u1','c2','DEV-2026-005','facture',100,20,120, now(),now()),
  ('d6','u1','c3','DEV-2026-006','brouillon',100,20,120, null,null),
  ('d7','u1','c3','DEV-2026-007','envoye', 100,20,120, now(),null),
  ('d8','u1','c3','DEV-2026-008','refuse', 100,20,120, now(),null);
INSERT INTO "DevisLine" ("id","devisId","description","quantity","unitPriceHT","tvaRate","totalHT") VALUES
  ('l1','d1','Poste 1',1,100,20,100),('l2','d1','Poste 2',1,100,20,100),('l3','d1','Poste 3',1,100,20,100),
  ('l4','d2','Poste',1,100,20,100),
  ('l5','d3','Poste 1',1,100,20,100),('l6','d3','Poste 2',1,100,20,100),
  ('l7','d4','Poste 1',1,100,20,100),('l8','d4','Poste 2',1,100,20,100),
  ('l9','d5','Poste',1,100,20,100),
  ('l10','d6','Poste',1,100,20,100),('l11','d7','Poste',1,100,20,100),('l12','d8','Poste',1,100,20,100),('l13','d8','Option',0,0,20,0);
INSERT INTO "Facture" ("id","userId","clientId","devisId","number","totalHT","totalTVA","totalTTC","status") VALUES
  ('f1','u1','c1','d1','FAC-2026-001',300,60,360,'emise'),
  ('f2','u1','c1','d2','FAC-2026-002',100,20,120,'payee'),
  ('f3','u1','c2','d3','FAC-2026-003',200,40,240,'payee'),
  ('f4','u1','c2','d4','FAC-2026-004',200,40,240,'payee'),
  ('f5','u1','c2','d5','FAC-2026-005',100,20,120,'emise');
`;

async function snapshot(db) {
  const res = await db.query(read(join(REPO, "scripts/db/catalog-snapshot.sql")));
  return res.rows.map((r) => r.l).join("\n");
}
async function count(db, sql) {
  return Number((await db.query(sql)).rows[0].n);
}
async function counts(db) {
  return {
    devis: await count(db, `SELECT count(*) n FROM "Devis"`),
    devisLines: await count(db, `SELECT count(*) n FROM "DevisLine"`),
    factures: await count(db, `SELECT count(*) n FROM "Facture"`),
    factureLines: await count(db, `SELECT count(*) n FROM "FactureLine"`),
    avoirs: await count(db, `SELECT count(*) n FROM "Avoir"`),
  };
}
async function fails(db, sql) {
  try {
    await db.exec(sql);
    return null;
  } catch (err) {
    await db.exec("ROLLBACK").catch(() => {});
    return err.message;
  }
}
const quiet = { log: () => {} };

const notices = [];
const db = new PGlite();
const exec = (sql) => db.exec(sql, { onNotice: (n) => notices.push(n.message) });
console.log(`PostgreSQL local : ${(await db.query("SELECT version() v")).rows[0].v.split(",")[0]}\n`);

// 1. Copie fidèle du schéma réel.
await db.exec(ddlFromCatalog(read(join(FIX, "catalog-20261022.txt"))));
const real = parseSnapshot(read(join(FIX, "snapshot-20261022.txt")));
const rebuilt = parseSnapshot(await snapshot(db));
const same = real.size === rebuilt.size && [...real].every((l) => rebuilt.has(l));
check("Copie locale identique au schéma Supabase (instantané)", same, `${rebuilt.size}/${real.size} éléments`);
check("Avant migration : seuls les écarts corrigés par les migrations", compare(await snapshot(db), "before", quiet).ok);

// 2. Données synthétiques de même forme.
await db.exec(SEED);
const before = await counts(db);
check("Données synthétiques", before.devis === 8 && before.devisLines === 13 && before.factures === 5 && before.factureLines === 0);

// 3. Atomicité : une migration qui échoue n'applique rien.
await db.exec(`INSERT INTO "Devis" ("id","userId","clientId","number") VALUES ('dup','u1','c1','DEV-2026-001')`);
const err = await fails(db, migration("20261022_unique_document_numbers_up.sql"));
const noIndex = (await db.query(`SELECT to_regclass('public."Devis_userId_number_key"') r`)).rows[0].r === null
  && (await db.query(`SELECT to_regclass('public."Facture_userId_number_key"') r`)).rows[0].r === null;
check("Migration 2 avec un doublon : échec sans effet partiel", err !== null && noIndex, err?.split("\n")[0]);
await db.exec(`DELETE FROM "Devis" WHERE "id" = 'dup'`);

// 4. Migrations 1 → 4.
for (const f of ["20261023_document_number_counters_up.sql", "20261022_unique_document_numbers_up.sql",
                 "20261022_restrict_accounting_document_deletion_up.sql", "20261023_freeze_invoice_lines_up.sql"]) {
  const e = await fails(db, migration(f));
  check(`Application de ${f}`, e === null, e ?? "");
}
check("Après migration : schéma conforme à schema.prisma (0 écart)", compare(await snapshot(db), "after", quiet).ok);
const after = await counts(db);
check("Aucune donnée perdue, 9 lignes de facture créées",
  after.devis === 8 && after.devisLines === 13 && after.factures === 5 && after.factureLines === 9 && after.avoirs === 0,
  JSON.stringify(after));
check("Totaux des lignes figées = totaux HT des factures", await count(db, `
  SELECT count(*) n FROM "Facture" f
  WHERE abs(f."totalHT" - (SELECT coalesce(sum("totalHT"),0) FROM "FactureLine" fl WHERE fl."factureId" = f."id")) > 0.005`) === 0);

// 5. Postcheck et tests de comportement (vrais fichiers du dépôt).
const execWithNotices = async (sql) => { try { await exec(sql); return null; } catch (x) { await db.exec("ROLLBACK").catch(() => {}); return x.message; } };
notices.length = 0;
let e = await execWithNotices(migration("20261023_postcheck.sql"));
check("Postcheck", e === null && notices.some((n) => n.startsWith("POSTCHECK OK")), e ?? notices.at(-1));
notices.length = 0;
e = await execWithNotices(migration("20261023_pg_behaviour_tests.sql"));
check("Tests de comportement PostgreSQL (T1–T10)", e === null && notices.includes("PG TESTS OK"), e ?? `${notices.filter((n) => / OK/.test(n)).length} notices OK`);
check("Tests de comportement : rien ne subsiste (ROLLBACK)", JSON.stringify(await counts(db)) === JSON.stringify(after)
  && await count(db, `SELECT count(*) n FROM "User" WHERE "id" LIKE 'pgtest_%'`) === 0);

// 6. Migration 4 relançable : sans doublon, et fige une facture créée entre-temps par l'ancienne version.
e = await fails(db, migration("20261023_freeze_invoice_lines_up.sql"));
check("Migration 4 relancée : aucune ligne dupliquée", e === null && (await counts(db)).factureLines === 9, e ?? "");
await db.exec(`INSERT INTO "Facture" ("id","userId","clientId","devisId","number","totalHT","totalTVA","totalTTC")
               VALUES ('f6','u1','c3','d7','FAC-2026-006',100,20,120)`);
await fails(db, migration("20261023_freeze_invoice_lines_up.sql"));
check("Migration 4 relancée : la nouvelle facture sans ligne est figée",
  await count(db, `SELECT count(*) n FROM "FactureLine" WHERE "factureId" = 'f6'`) === 1);

// 7. Garde-fous des retours arrière.
await db.exec(`INSERT INTO "DocumentNumberCounter" ("id","userId","kind","series","nextValue","updatedAt") VALUES ('k1','u1','devis','DEV-2026-',9,now())`);
e = await fails(db, migration("20261023_document_number_counters_down.sql"));
check("Retour arrière 1 refusé si des compteurs seraient perdus", e?.includes("Retour arrière refusé") &&
  (await db.query(`SELECT to_regclass('public."DocumentNumberCounter"') r`)).rows[0].r !== null, e?.split("\n")[0]);
await db.exec(`INSERT INTO "Avoir" ("id","userId","factureId","clientId","number","reason","totalHT","totalTVA","totalTTC")
               VALUES ('a1','u1','f1','c1','AV-2026-001','test',300,60,360)`);
e = await fails(db, migration("20261023_freeze_invoice_lines_down.sql"));
check("Retour arrière 4 refusé si un avoir a été émis après le gel", e?.includes("Retour arrière refusé") && (await counts(db)).factureLines === 10, e?.split("\n")[0]);
e = await fails(db, migration("20261022_restrict_accounting_document_deletion_down.sql"));
// Retour arrière 3 possible même avec un avoir (aucune donnée supprimée) — on le ré-applique ensuite.
check("Retour arrière 3 sans perte", e === null && JSON.stringify(await counts(db)) === JSON.stringify({ ...after, factures: 6, factureLines: 10, avoirs: 1 }), e ?? "");
await fails(db, migration("20261022_restrict_accounting_document_deletion_up.sql"));

// 8. Retour arrière complet (ordre 4 → 1), forcé en connaissance de cause
//    (SET gestly.confirm_…), puis comparaison.
await db.exec(`SET gestly.confirm_counter_loss = 'oui'; SET gestly.confirm_freeze_rollback = 'oui';`);
for (const f of ["20261023_freeze_invoice_lines_down.sql", "20261022_restrict_accounting_document_deletion_down.sql",
                 "20261022_unique_document_numbers_down.sql", "20261023_document_number_counters_down.sql"]) {
  const x = await fails(db, migration(f));
  check(`Retour arrière ${f}`, x === null, x ?? "");
}
const restored = parseSnapshot(await snapshot(db));
check("Après retour arrière complet : schéma identique à l'original", restored.size === real.size && [...real].every((l) => restored.has(l)));
check("Après retour arrière : lignes figées supprimées, autres données intactes",
  JSON.stringify(await counts(db)) === JSON.stringify({ ...before, factures: 6, avoirs: 1 }),
  JSON.stringify(await counts(db)));
await db.exec(`RESET gestly.confirm_counter_loss; RESET gestly.confirm_freeze_rollback;`);
check("Table de traçabilité supprimée", (await db.query(`SELECT to_regclass('public."_Backfill20261023FactureLine"') r`)).rows[0].r === null);

// 9. Ré-application après retour arrière.
for (const f of ["20261023_document_number_counters_up.sql", "20261022_unique_document_numbers_up.sql",
                 "20261022_restrict_accounting_document_deletion_up.sql", "20261023_freeze_invoice_lines_up.sql"]) {
  const x = await fails(db, migration(f));
  check(`Ré-application de ${f}`, x === null, x ?? "");
}
check("Après ré-application : schéma conforme (0 écart)", compare(await snapshot(db), "after", quiet).ok);

await db.close();
console.log(`\n${failures === 0 ? "RÉPÉTITION RÉUSSIE" : `${failures} ÉCHEC(S)`}`);
process.exit(failures === 0 ? 0 : 1);
