// Comparaison hors ligne : instantané du schéma PostgreSQL (produit par
// scripts/db/catalog-snapshot.sql) ↔ état cible de prisma/schema.prisma.
// N'ouvre aucune connexion : lit deux fichiers et des SQL de migration.
//
// Usage :
//   node scripts/db/compare-schema.mjs <instantané.txt> --expect=before
//     Base AVANT migration : les seuls écarts doivent être ceux que les 4
//     migrations corrigent (vérifié en les appliquant en simulation).
//   node scripts/db/compare-schema.mjs <instantané.txt> --expect=after
//     Base APRÈS migration : aucun écart.
// Code de sortie 0 = conforme, 1 = écart, 2 = erreur d'usage.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const MIGRATION_ORDER = [
  "20261023_document_number_counters_up.sql",
  "20261022_unique_document_numbers_up.sql",
  "20261022_restrict_accounting_document_deletion_up.sql",
  "20261023_freeze_invoice_lines_up.sql",
];

// Divergence connue : index partiel non exprimable dans schema.prisma
// (cf. CLAUDE.md, ne jamais utiliser prisma db push).
const KNOWN = new Set(['I|Notification|Notification_userId_dedupeKey_key|true|userId,dedupeKey|("dedupeKey" IS NOT NULL)']);

const TYPES = { String: "text", Int: "int4", Float: "float8", Boolean: "bool", DateTime: "timestamp", Json: "jsonb" };
const DEL = { Cascade: "c", Restrict: "r", SetNull: "n", NoAction: "a", SetDefault: "d" };

// État attendu, au format de l'instantané, dérivé de schema.prisma
// (conventions de nommage Prisma : <Modèle>_<champs>_key|idx|fkey).
export function expectedFromPrisma(schemaText) {
  const models = [...schemaText.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map(([, name, body]) => ({ name, body }));
  const modelNames = new Set(models.map((m) => m.name));
  const expected = new Set();
  for (const { name, body } of models) {
    if (/@@map|@map\(/.test(body)) throw new Error(`${name} : @map / @@map non gérés par ce script`);
    for (const raw of body.split("\n")) {
      const line = raw.replace(/\/\/.*$/, "").trim();
      if (!line) continue;
      if (line.startsWith("@@")) {
        const m = line.match(/^@@(unique|index)\(\[([^\]]+)\]/);
        if (!m) continue;
        const cols = m[2].split(",").map((s) => s.trim());
        expected.add(`I|${name}|${name}_${cols.join("_")}_${m[1] === "unique" ? "key" : "idx"}|${m[1] === "unique"}|${cols.join(",")}|`);
        continue;
      }
      const f = line.match(/^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f) continue;
      const [, field, type, list, opt, attrs] = f;
      if (modelNames.has(type)) {
        const rel = attrs.match(/fields:\s*\[([^\]]+)\]/);
        if (!rel || list) continue;
        const cols = rel[1].split(",").map((s) => s.trim());
        const od = attrs.match(/onDelete:\s*(\w+)/);
        expected.add(`F|${name}|${name}_${cols.join("_")}_fkey|${cols.join(",")}|${type}|${od ? DEL[od[1]] : opt ? "n" : "r"}|c`);
        continue;
      }
      if (!TYPES[type]) throw new Error(`Type non géré : ${name}.${field} ${type}`);
      expected.add(`C|${name}|${field}|${TYPES[type]}|${opt ? "YES" : "NO"}`);
      if (/@unique\b/.test(attrs)) expected.add(`I|${name}|${name}_${field}_key|true|${field}|`);
    }
  }
  return { expected, modelCount: models.length };
}

// Applique en simulation les migrations « up » à un instantané. Toute
// instruction non reconnue, ou un DROP CONSTRAINT sur une contrainte
// absente, lève une erreur (la migration réelle échouerait aussi).
export function simulateMigrations(snapshot, migDir) {
  const after = new Set(snapshot);
  const ignored = [];
  const SQLTYPES = { TEXT: "text", INTEGER: "int4", "TIMESTAMP(3)": "timestamp" };
  const RULE = { CASCADE: "c", RESTRICT: "r", "SET NULL": "n" };
  for (const file of MIGRATION_ORDER) {
    const sql = readFileSync(join(migDir, file), "utf8").replace(/--.*$/gm, "");
    for (const stmt of sql.split(";").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) {
      let m;
      if (/^(BEGIN|COMMIT)$/.test(stmt)) continue;
      if ((m = stmt.match(/^CREATE TABLE (?:IF NOT EXISTS )?"(\w+)" \((.*)\)$/))) {
        if (m[1].startsWith("_")) { ignored.push(`${file} : table ${m[1]} (traçabilité, hors schema.prisma)`); continue; }
        for (const part of m[2].split(/,(?![^(]*\))/).map((s) => s.trim())) {
          const c = part.match(/^"(\w+)" (\S+)( NOT NULL)?/);
          if (c) after.add(`C|${m[1]}|${c[1]}|${SQLTYPES[c[2]] ?? c[2]}|${c[3] ? "NO" : "YES"}`);
        }
      } else if ((m = stmt.match(/^CREATE UNIQUE INDEX "(\w+)" ON "(\w+)" \(([^)]+)\)$/))) {
        after.add(`I|${m[2]}|${m[1]}|true|${m[3].replace(/[" ]/g, "")}|`);
      } else if ((m = stmt.match(/^ALTER TABLE "(\w+)" DROP CONSTRAINT "(\w+)"$/))) {
        const found = [...after].find((l) => l.startsWith(`F|${m[1]}|${m[2]}|`));
        if (!found) throw new Error(`${file} : contrainte ${m[2]} absente, le DROP CONSTRAINT échouerait`);
        after.delete(found);
      } else if ((m = stmt.match(/^ALTER TABLE "(\w+)" ADD CONSTRAINT "(\w+)" FOREIGN KEY \("(\w+)"\) REFERENCES "(\w+)"\("id"\) ON DELETE (\w+) ON UPDATE (\w+)$/))) {
        after.add(`F|${m[1]}|${m[2]}|${m[3]}|${m[4]}|${RULE[m[5]]}|${RULE[m[6]]}`);
      } else if (/ENABLE ROW LEVEL SECURITY$/.test(stmt) || /^WITH inserted AS/.test(stmt)) {
        ignored.push(`${file} : ${stmt.slice(0, 50)}… (RLS ou données, hors schema.prisma)`);
      } else {
        throw new Error(`${file} : instruction non reconnue : ${stmt.slice(0, 80)}`);
      }
    }
  }
  return { after, ignored };
}

export function diff(expected, real) {
  return {
    missing: [...expected].filter((l) => !real.has(l)).sort(),
    extra: [...real].filter((l) => !expected.has(l) && !KNOWN.has(l)).sort(),
  };
}

export function parseSnapshot(text) {
  return new Set(text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[CIF]\|/.test(l)));
}

export function compare(snapshotText, mode, { repo = REPO, log = console.log } = {}) {
  const { expected, modelCount } = expectedFromPrisma(readFileSync(join(repo, "prisma/schema.prisma"), "utf8"));
  const actual = parseSnapshot(snapshotText);
  const report = (label, d) => {
    log(`\n== ${label} : ${d.missing.length + d.extra.length} écart(s)`);
    d.missing.forEach((l) => log("  - attendu, absent : " + l));
    d.extra.forEach((l) => log("  + présent, non attendu : " + l));
  };
  log(`schema.prisma : ${modelCount} modèles, ${expected.size} éléments ; instantané : ${actual.size} éléments`);
  const now = diff(expected, actual);
  report("Base ↔ schema.prisma", now);
  let ok;
  if (mode === "after") {
    ok = now.missing.length + now.extra.length === 0;
  } else {
    const { after, ignored } = simulateMigrations(actual, join(repo, "prisma/manual-migrations"));
    const sim = diff(expected, after);
    report("Base + 4 migrations simulées ↔ schema.prisma", sim);
    ignored.forEach((l) => log("  · ignoré : " + l));
    ok = sim.missing.length + sim.extra.length === 0;
  }
  log(`\nDivergence connue exclue : index partiel Notification_userId_dedupeKey_key.`);
  log(`RÉSULTAT (${mode}) : ${ok ? "CONFORME" : "NON CONFORME"}`);
  return { ok, current: now };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [file, flag] = process.argv.slice(2);
  const mode = flag?.replace(/^--expect=/, "");
  if (!file || !["before", "after"].includes(mode)) {
    console.error("Usage : node scripts/db/compare-schema.mjs <instantané.txt> --expect=before|after");
    process.exit(2);
  }
  process.exit(compare(readFileSync(file, "utf8"), mode).ok ? 0 : 1);
}
