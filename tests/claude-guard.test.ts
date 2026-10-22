import { describe, it, expect } from "vitest";
// Hook Claude Code en JavaScript pur (exécuté directement par node).
import { evaluate, isReadOnlySql } from "../.claude/hooks/guard.mjs";

type Verdict = { decision: "allow" | "ask" | "block"; block: boolean; reason?: string };
const run = (tool: string, input: Record<string, unknown>): Verdict => evaluate(tool, input);
const bash = (command: string) => run("Bash", { command }).decision;
const ps = (command: string) => run("PowerShell", { command }).decision;
const sql = (query: string) => run("mcp__claude_ai_Supabase__execute_sql", { query }).decision;

describe("garde-fou v2 — refus (réservé à l'utilisateur)", () => {
  it.each([
    // Secrets
    "cat .env.local",
    "type .env",
    "head -5 .env.production.local",
    'node -e "console.log(require(\'fs\').readFileSync(\'.env.local\',\'utf8\'))"',
    "grep DATABASE_URL .env.local",
    "cp .env.local /tmp/x",
    "printenv",
    "env | grep KEY",
    'git -C "C:/Users/utaku/gestly ancien PC" remote -v',
    'cat "C:/Users/utaku/gestly ancien PC/.git/config"',
    "gh secret list",
    "npx supabase secrets list",
    // Schéma et base
    "npx prisma db push",
    "npm.cmd exec -- prisma db push --accept-data-loss",
    "node node_modules/prisma/build/index.js db push",
    "npx prisma migrate dev --name x",
    "npx prisma migrate reset --force",
    "npx prisma migrate deploy",
    "npx prisma db execute --file x.sql",
    "npx prisma db pull",
    "npx supabase db reset",
    "npx supabase db push",
    // Déploiement et publication
    "vercel --prod",
    "npx vercel deploy",
    "npx --yes vercel env pull",
    "pnpm dlx vercel",
    "git push",
    "git push origin chore/claude-setup",
    "git -C . push --force",
    "git status && git push",
    "gh pr create --fill",
    "npm publish",
    // Envois et paiements réels
    "OUTBOUND_MODE=live npm run dev",
    "VERCEL_ENV=production npm run dev",
    "curl -X POST https://graph.facebook.com/v20.0/123/messages",
    "curl https://api.resend.com/emails",
    "curl https://api.stripe.com/v1/charges -u sk:",
    "curl https://www.gestly.fr/api/relances/check",
    "stripe charges create --amount 100",
    "stripe refunds create",
    // Sauvegardes et garde-fous
    "rm -rf ~/gestly-backups/20261022-120000",
    "dangerously-skip-permissions",
    "rm .claude/hooks/guard.mjs",
    "echo {} > .claude/settings.json",
    "sed -i s/a/b/ .claude/settings.json",
    "git checkout -- .claude/hooks/guard.mjs",
    // Contournements évidents
    'bash -c "npx prisma db push"',
    "sh -c 'git push'",
    "npx   prisma    db   push",
    "echo ok; vercel deploy",
    "true || git push",
  ])("Bash refuse : %s", (cmd) => {
    expect(bash(cmd)).toBe("block");
  });

  it.each([
    "Get-Content .env.local",
    "Get-ChildItem env:",
    "$env:OUTBOUND_MODE = 'live'; npm.cmd run dev",
    "npm.cmd exec -- prisma migrate reset",
    "git push origin main",
    "vercel.cmd --prod",
    "Remove-Item -Recurse $HOME\\gestly-backups\\20261022",
    "Invoke-RestMethod https://api.openai.com/v1/models",
    "Set-Content .claude\\settings.json '{}'",
  ])("PowerShell refuse : %s", (cmd) => {
    expect(ps(cmd)).toBe("block");
  });

  it("outils fichiers : .env, garde-fous et sauvegardes", () => {
    for (const tool of ["Read", "Edit", "Write"]) {
      expect(run(tool, { file_path: "C:\\Users\\utaku\\Gestly\\.env.local" }).block).toBe(true);
      expect(run(tool, { file_path: "/c/Users/utaku/Gestly/.env" }).block).toBe(true);
    }
    expect(run("Read", { file_path: "C:/Users/utaku/gestly ancien PC/.git/config" }).block).toBe(true);
    expect(run("Grep", { pattern: "KEY", path: ".env.local" }).block).toBe(true);
    expect(run("Grep", { pattern: "KEY", glob: ".env*" }).block).toBe(true);
    expect(run("Edit", { file_path: "C:\\Users\\utaku\\Gestly\\.claude\\settings.json" }).block).toBe(true);
    expect(run("Write", { file_path: "/c/Users/utaku/Gestly/.claude/hooks/guard.mjs" }).block).toBe(true);
    expect(run("Write", { file_path: "C:\\Users\\utaku\\gestly-backups\\x\\public.dump" }).block).toBe(true);
  });

  it("connecteur Supabase : outils d'infrastructure refusés", () => {
    expect(run("mcp__claude_ai_Supabase__apply_migration", { query: "select 1" }).block).toBe(true);
    expect(run("mcp__claude_ai_Supabase__reset_branch", {}).block).toBe(true);
    expect(run("mcp__claude_ai_Supabase__create_edge_function_secret", {}).block).toBe(true);
  });
});

describe("garde-fou v2 — accord demandé", () => {
  it.each([
    // Base distante
    "psql $env:GESTLY_DB_URL -X -v ON_ERROR_STOP=1 -f prisma/manual-migrations/20261023_document_number_counters_up.sql",
    'psql "$DATABASE_URL" -c "select 1"',
    "pg_restore -d $env:GESTLY_DB_URL backup.dump",
    "dropdb -h db.abc.supabase.co postgres",
    "psql postgres://x",
    // Git local destructif
    "git reset --hard HEAD~1",
    "git clean -fd",
    "git checkout -- .",
    "git branch -D feat/x",
    "git stash drop",
    // Suppression hors du projet
    "rm -rf /c/Users/utaku/Documents",
    "rm -rf ../autre-projet",
    "Remove-Item -Recurse -Force C:\\Users\\utaku\\Desktop\\x",
  ])("accord demandé : %s", (cmd) => {
    expect(bash(cmd)).toBe("ask");
  });

  it.each([
    'DROP TABLE "User"',
    'truncate "Devis"',
    'delete from "Client"',
    "ALTER TABLE x ADD y int",
    "insert into \"Client\" (id) values ('x')",
    'update "Devis" set status = \'paye\'',
    "select 1; delete from x",
    "create table t (id int)",
    "do $$ begin perform 1; end $$",
    "select * into nouvelle from \"Devis\"",
  ])("SQL Supabase soumis à accord : %s", (q) => {
    expect(sql(q)).toBe("ask");
  });
});

describe("garde-fou v2 — développement autorisé sans confirmation", () => {
  it.each([
    "npm.cmd test -- --run",
    "npm install zod@3.25.0",
    "npm.cmd ci",
    "npx tsc --noEmit",
    "npm run lint",
    "npm run build",
    "npm run dev",
    "OUTBOUND_MODE=simulate npm run dev",
    "npx prisma generate",
    "npx prisma validate",
    "npx prisma format",
    "npx prisma migrate diff --from-schema a.prisma --to-schema prisma/schema.prisma --script",
    "git status",
    "git checkout -b feat/x",
    "git switch main",
    "git add .env.example CLAUDE.md",
    'git commit -m "feat: déploiement Vercel documenté"',
    "git stash push -m wip",
    "git merge --no-ff feat/x",
    "git log --oneline -5",
    "cat .env.example",
    "cat .claude/settings.json 2>/dev/null",
    "grep -rn process.env lib",
    "rm -rf .next",
    "rm -rf node_modules/.cache",
    "rm -rf /c/Users/utaku/AppData/Local/Temp/claude/x",
    "node scripts/db/rehearse-migrations.mjs",
    "node scripts/db/compare-schema.mjs snap.txt --expect=after",
    "powershell -ExecutionPolicy Bypass -File scripts\\db\\backup.ps1",
    "powershell -ExecutionPolicy Bypass -File scripts\\db\\verify-backup.ps1 -BackupDir C:\\Users\\utaku\\gestly-backups\\x -Rehearse",
    "ls ~/gestly-backups",
    // PostgreSQL local
    "psql -h localhost -p 54329 -U postgres -d gestly_restore -f prisma/manual-migrations/20261023_postcheck.sql",
    "pg_restore --list backup.dump",
    "pg_restore -h localhost -p 54329 -d gestly_restore backup.dump",
    "createdb -h localhost -p 54329 -U postgres gestly_restore",
    "initdb -D /tmp/pg -U postgres -A trust",
    "pg_ctl -D /tmp/pg -o \"-p 54329\" start",
    "psql --version",
    "pg_dump --version",
    "stripe listen --forward-to localhost:3000/api/stripe/webhook",
  ])("autorise : %s", (cmd) => {
    expect(bash(cmd)).toBe("allow");
  });

  it.each([
    'select count(*) from "Devis"',
    "SELECT to_regclass('public.\"DocumentNumberCounter\"')",
    "with x as (select 1) select * from x",
    "select 'create table' as texte_inoffensif",
    "select pg_get_indexdef(oid) from pg_class -- drop table dans un commentaire",
    "explain select 1",
    "show server_version",
  ])("SQL Supabase en lecture autorisé : %s", (q) => {
    expect(sql(q)).toBe("allow");
    expect(isReadOnlySql(q)).toBe(true);
  });

  it("outils fichiers et connecteur : lecture et code autorisés", () => {
    expect(run("Read", { file_path: "C:/Users/utaku/Gestly/.env.example" }).block).toBe(false);
    expect(run("Edit", { file_path: "C:/Users/utaku/Gestly/lib/outbound/mode.ts" }).block).toBe(false);
    expect(run("Write", { file_path: "C:/Users/utaku/Gestly/prisma/manual-migrations/x_up.sql" }).block).toBe(false);
    expect(run("Read", { file_path: "C:/Users/utaku/Gestly/.claude/settings.json" }).block).toBe(false);
    expect(run("Read", { file_path: "C:/Users/utaku/gestly-backups/x/counts-source.txt" }).block).toBe(false);
    expect(run("Grep", { pattern: "isOutboundSimulated", path: "lib" }).block).toBe(false);
    expect(run("mcp__claude_ai_Supabase__list_tables", {}).decision).toBe("allow");
  });
});
