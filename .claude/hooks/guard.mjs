#!/usr/bin/env node
// Garde-fou Claude Code (hook PreToolUse) pour Gestly.
//
// Bloque, avant exécution, les actions interdites par CLAUDE.md :
//   - accès aux secrets (.env*, sauf .env.example ; remote Git de l'ancien PC) ;
//   - opérations de base destructives (prisma db push / migrate / db execute,
//     supabase db push|reset, psql, SQL destructif via le connecteur Supabase) ;
//   - déploiements (vercel) et publications GitHub (git push, gh pr create...) ;
//   - activation des envois réels (OUTBOUND_MODE=live, VERCEL_ENV=production) ;
//   - modification des garde-fous eux-mêmes (.claude/settings*.json, .claude/hooks/).
//
// Protocole : JSON sur stdin ({ tool_name, tool_input }). Code de sortie 2 =
// action bloquée (le message sur stderr est renvoyé à Claude). Toute erreur
// interne bloque aussi (échec fermé).
//
// LIMITES (voir CLAUDE.md) : analyse textuelle uniquement. Ne voit pas le
// contenu d'un script écrit puis exécuté, ni une commande obfusquée (base64,
// variables concaténées). Ne remplace pas les protections applicatives
// (lib/outbound/mode.ts) ni l'absence de secrets de production sur le poste.

import { pathToFileURL } from "node:url";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

// Fichier .env (avec ou sans suffixe), à l'exception de .env.example.
const ENV_FILE_IN_TEXT = /(^|[\s"'`=:/\\(<>|;&,])\.env(?!\.example\b)(\.[\w.-]+)?(?=$|[\s"'`)/\\;&|<>,*])/i;
const ENV_BASENAME = /^\.env(?!\.example$)(\..+)?$/i;
const OLD_PC_SECRET = /ancien[ _-]?pc[\s\S]*(\.git[/\\]+config|\.env|\bremote\b|\bconfig\b)/i;

const SHELL_RULES = [
  { re: ENV_FILE_IN_TEXT, why: "accès à un fichier .env (secrets) — seul .env.example est autorisé" },
  { re: OLD_PC_SECRET, why: "accès aux secrets de la copie de l'ancien PC (.env, configuration/remote Git avec token)" },
  { re: /(^|[\s;&|(])(printenv|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:|ls\s+env:)/i, why: "affichage des variables d'environnement (secrets)" },
  { re: /(^|[;&|(]\s*)env\s*($|[|;&>])/i, why: "affichage des variables d'environnement (secrets)" },
  { re: /\bdb\s+push\b/i, why: "`db push` (prisma/supabase) : modification destructive du schéma" },
  { re: /\bmigrate\s+(dev|deploy|reset|resolve)\b/i, why: "migration Prisma (soumise à accord explicite)" },
  { re: /\bdb\s+(execute|pull|seed)\b/i, why: "`prisma db execute|pull|seed` : exécution SQL ou réécriture du schéma" },
  { re: /--(force-reset|accept-data-loss)\b/i, why: "option destructive Prisma" },
  { re: /\bsupabase\s+(db\s+(reset|push)|migration\s+(up|repair)|link)\b/i, why: "commande Supabase CLI modifiant la base" },
  { re: /(^|[\s;&|(])(psql|pg_restore|dropdb|createdb)(\.exe)?(\s|$)/i, why: "client PostgreSQL direct" },
  { re: /prisma\/manual-migrations\/[^\s"']*\.sql/i, why: "exécution d'un script SQL de migration (soumise à accord explicite)", onlyIf: /(psql|execute|supabase|<\s*prisma)/i },
  { re: /(^|[\s;&|(`'"])((npx|bunx)\s+(--yes\s+|-y\s+)?|pnpm\s+(dlx\s+)?|yarn\s+(dlx\s+)?|npm\s+(exec|x)\s+(--\s+)?)?vercel(\.cmd|\.exe)?(\s|$)/i, why: "commande Vercel (déploiement / variables de production)" },
  { re: /\bgit\b(?:(?!\bstash\b)[^;&|\n])*\spush\b/i, why: "git push (publication sur GitHub interdite sans accord)" },
  { re: /\bgh\s+(pr\s+(create|merge)|repo\s+(sync|create|delete)|release\s+create|api\b[^;&|]*-X\s*(POST|PUT|PATCH|DELETE))/i, why: "publication GitHub via gh" },
  { re: /\bOUTBOUND_MODE\s*=\s*["']?live\b/i, why: "activation des envois réels (OUTBOUND_MODE=live) réservée à l'utilisateur" },
  { re: /\$env:OUTBOUND_MODE\s*=\s*["']?live/i, why: "activation des envois réels (OUTBOUND_MODE=live) réservée à l'utilisateur" },
  { re: /\bVERCEL_ENV\s*=\s*["']?production\b|\$env:VERCEL_ENV\s*=\s*["']?production/i, why: "simulation de l'environnement de production (VERCEL_ENV=production)" },
  { re: /dangerously/i, why: "contournement des permissions" },
  { re: /\.claude[/\\]+(settings(\.local)?\.json|hooks)\b/i, why: "modification des garde-fous Claude Code", onlyIf: /(>|\bsed\b|\btee\b|\brm\b|\bmv\b|\bcp\b|Set-Content|Out-File|Remove-Item|Move-Item|Copy-Item|\bdel\b|\bwrite)/i },
];

const SQL_DESTRUCTIVE = /\b(drop|truncate|delete|alter|grant|revoke|create|comment\s+on|reindex|vacuum|cluster|copy)\b/i;

const DENIED_MCP = /^mcp__.*supabase.*__(apply_migration|deploy_edge_function|create_edge_function_secret|delete_branch|reset_branch|merge_branch|rebase_branch|create_branch|create_project|pause_project|restore_project)$/i;

function normalizePath(p) {
  return String(p ?? "").replace(/\\/g, "/");
}

function basename(p) {
  const parts = normalizePath(p).split("/");
  return parts[parts.length - 1] ?? "";
}

export function evaluate(toolName, toolInput = {}) {
  if (SHELL_TOOLS.has(toolName)) {
    const command = String(toolInput.command ?? "");
    for (const rule of SHELL_RULES) {
      if (rule.re.test(command) && (!rule.onlyIf || rule.onlyIf.test(command))) {
        return { block: true, reason: rule.why };
      }
    }
    return { block: false };
  }

  if (FILE_TOOLS.has(toolName)) {
    const p = toolInput.file_path ?? toolInput.notebook_path ?? "";
    if (ENV_BASENAME.test(basename(p))) {
      return { block: true, reason: "accès à un fichier .env (secrets) — seul .env.example est autorisé" };
    }
    if (OLD_PC_SECRET.test(normalizePath(p))) {
      return { block: true, reason: "accès aux secrets de la copie de l'ancien PC" };
    }
    if (WRITE_TOOLS.has(toolName) && /(^|\/)\.claude\/(settings(\.local)?\.json$|hooks\/)/i.test(normalizePath(p))) {
      return { block: true, reason: "modification des garde-fous Claude Code (à faire par l'utilisateur)" };
    }
    return { block: false };
  }

  if (toolName === "Grep") {
    const target = `${toolInput.path ?? ""} ${toolInput.glob ?? ""}`;
    if (ENV_FILE_IN_TEXT.test(` ${target}`) || ENV_BASENAME.test(basename(toolInput.path))) {
      return { block: true, reason: "recherche dans un fichier .env (secrets)" };
    }
    if (OLD_PC_SECRET.test(normalizePath(toolInput.path))) {
      return { block: true, reason: "recherche dans les secrets de la copie de l'ancien PC" };
    }
    return { block: false };
  }

  if (DENIED_MCP.test(toolName)) {
    return { block: true, reason: "outil Supabase modifiant l'infrastructure ou le schéma (soumis à accord explicite)" };
  }

  if (/^mcp__.*supabase.*__execute_sql$/i.test(toolName)) {
    if (SQL_DESTRUCTIVE.test(String(toolInput.query ?? ""))) {
      return { block: true, reason: "SQL de structure ou de suppression via le connecteur Supabase (soumis à accord explicite)" };
    }
    return { block: false };
  }

  return { block: false };
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const { block, reason } = evaluate(input.tool_name, input.tool_input ?? {});
  if (block) {
    process.stderr.write(
      `Bloqué par le garde-fou Gestly (.claude/hooks/guard.mjs) : ${reason}. ` +
        "Voir CLAUDE.md ; cette action nécessite l'accord explicite de l'utilisateur, qui doit l'exécuter lui-même.\n"
    );
    process.exit(2);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`Garde-fou Gestly : erreur interne, action bloquée par sécurité (${err?.message ?? err}).\n`);
    process.exit(2);
  });
}
