import { describe, it, expect } from "vitest";
// Hook Claude Code en JavaScript pur (exécuté directement par node).
import { evaluate } from "../.claude/hooks/guard.mjs";

type Verdict = { block: boolean; reason?: string };
const run = (tool: string, input: Record<string, unknown>): Verdict => evaluate(tool, input);
const bash = (command: string) => run("Bash", { command });
const ps = (command: string) => run("PowerShell", { command });

describe("garde-fou Claude Code — commandes interdites", () => {
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
    // Base de données
    "npx prisma db push",
    "npm.cmd exec -- prisma db push --accept-data-loss",
    "node node_modules/prisma/build/index.js db push",
    "npx prisma migrate dev --name x",
    "npx prisma migrate reset --force",
    "npx prisma migrate deploy",
    "npx prisma db execute --file x.sql",
    "npx prisma db pull",
    "npx supabase db reset",
    "psql postgres://x",
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
    // Envois réels
    "OUTBOUND_MODE=live npm run dev",
    "VERCEL_ENV=production npm run dev",
    // Contournements évidents
    'bash -c "npx prisma db push"',
    "sh -c 'git push'",
    "npx   prisma    db   push",
    "echo ok; vercel deploy",
    "true || git push",
  ])("Bash bloque : %s", (cmd) => {
    expect(bash(cmd).block).toBe(true);
  });

  it.each([
    "Get-Content .env.local",
    "Get-ChildItem env:",
    "$env:OUTBOUND_MODE = 'live'; npm.cmd run dev",
    "npm.cmd exec -- prisma migrate reset",
    "git push origin main",
    "vercel.cmd --prod",
  ])("PowerShell bloque : %s", (cmd) => {
    expect(ps(cmd).block).toBe(true);
  });

  it("outils fichiers : lecture et écriture des .env bloquées", () => {
    for (const tool of ["Read", "Edit", "Write"]) {
      expect(run(tool, { file_path: "C:\\Users\\utaku\\Gestly\\.env.local" }).block).toBe(true);
      expect(run(tool, { file_path: "/c/Users/utaku/Gestly/.env" }).block).toBe(true);
    }
    expect(run("Read", { file_path: "C:/Users/utaku/gestly ancien PC/.git/config" }).block).toBe(true);
    expect(run("Grep", { pattern: "KEY", path: ".env.local" }).block).toBe(true);
    expect(run("Grep", { pattern: "KEY", glob: ".env*" }).block).toBe(true);
  });

  it("outils fichiers : modification des garde-fous bloquée", () => {
    expect(run("Edit", { file_path: "C:\\Users\\utaku\\Gestly\\.claude\\settings.json" }).block).toBe(true);
    expect(run("Write", { file_path: "/c/Users/utaku/Gestly/.claude/hooks/guard.mjs" }).block).toBe(true);
    expect(bash("rm .claude/hooks/guard.mjs").block).toBe(true);
    expect(bash("echo {} > .claude/settings.json").block).toBe(true);
  });

  it("connecteur Supabase : outils d'infrastructure et SQL destructif bloqués", () => {
    expect(run("mcp__claude_ai_Supabase__apply_migration", { query: "select 1" }).block).toBe(true);
    expect(run("mcp__claude_ai_Supabase__reset_branch", {}).block).toBe(true);
    for (const q of ["DROP TABLE \"User\"", "truncate \"Devis\"", "delete from \"Client\"", "ALTER TABLE x ADD y int"]) {
      expect(run("mcp__claude_ai_Supabase__execute_sql", { query: q }).block, q).toBe(true);
    }
  });
});

describe("garde-fou Claude Code — commandes légitimes autorisées", () => {
  it.each([
    "npm.cmd test -- --run",
    "npx tsc --noEmit",
    "npm run lint",
    "npx prisma generate",
    "npx prisma validate",
    "git status",
    "git add .env.example CLAUDE.md",
    "git commit -m \"feat: x\"",
    "git stash push -m wip",
    "git log --oneline -5",
    "cat .env.example",
    "grep -rn process.env lib",
    "npm ls @vercel/functions",
    "node -e \"console.log(process.env.NODE_ENV)\"",
    "OUTBOUND_MODE=simulate npm run dev",
  ])("Bash autorise : %s", (cmd) => {
    expect(bash(cmd)).toEqual({ block: false });
  });

  it("outils fichiers : code et .env.example autorisés", () => {
    expect(run("Read", { file_path: "C:/Users/utaku/Gestly/.env.example" }).block).toBe(false);
    expect(run("Edit", { file_path: "C:/Users/utaku/Gestly/lib/outbound/mode.ts" }).block).toBe(false);
    expect(run("Read", { file_path: "C:/Users/utaku/Gestly/.claude/settings.json" }).block).toBe(false);
    expect(run("Grep", { pattern: "isOutboundSimulated", path: "lib" }).block).toBe(false);
  });

  it("connecteur Supabase : lecture SQL autorisée (confirmation demandée par settings.json)", () => {
    expect(run("mcp__claude_ai_Supabase__execute_sql", { query: "select count(*) from \"Devis\"" }).block).toBe(false);
    expect(run("mcp__claude_ai_Supabase__list_tables", {}).block).toBe(false);
  });
});
