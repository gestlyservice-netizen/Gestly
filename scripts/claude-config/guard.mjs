#!/usr/bin/env node
// Garde-fou Claude Code (hook PreToolUse) pour Gestly — version 2.
//
// Trois décisions :
//   - "allow" : le hook n'intervient pas (les règles de settings.json s'appliquent) ;
//   - "ask"   : Claude Code demande l'accord de l'utilisateur avant d'exécuter
//               (actions à risque mais légitimes : SQL d'écriture sur Supabase,
//               psql vers une base distante, perte de travail Git local,
//               suppression récursive hors du projet) ;
//   - "block" : refus, l'action reste réservée à l'utilisateur (secrets,
//               migrations Prisma et Supabase CLI, déploiement, push, envois et
//               paiements réels, suppression de sauvegardes, modification des
//               garde-fous).
//
// Protocole : JSON sur stdin ({ tool_name, tool_input }). Blocage : code de
// sortie 2 (message sur stderr renvoyé à Claude). Demande d'accord : JSON
// hookSpecificOutput.permissionDecision = "ask" sur stdout, code 0. Toute
// erreur interne bloque (échec fermé).
//
// LIMITES (voir CLAUDE.md) : analyse textuelle uniquement. Ne voit pas le
// contenu d'un script écrit puis exécuté, ni une commande obfusquée. Ne
// remplace pas les protections applicatives (lib/outbound/mode.ts).

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const norm = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\/([a-z])\//i, "$1:/").toLowerCase();
const PROJECT_ROOT = norm(process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "../.."));

// Fichier .env (avec ou sans suffixe), à l'exception de .env.example.
const ENV_FILE_IN_TEXT = /(^|[\s"'`=:/\\(<>|;&,])\.env(?!\.example\b)(\.[\w.-]+)?(?=$|[\s"'`)/\\;&|<>,*])/i;
const ENV_BASENAME = /^\.env(?!\.example$)(\..+)?$/i;
const OLD_PC_SECRET = /ancien[ _-]?pc[\s\S]*(\.git[/\\]+config|\.env|\bremote\b|\bconfig\b)/i;
// Début de commande : début de ligne, après un séparateur ou un guillemet (bash -c "...").
const CMD = String.raw`(?:^|[;&|(\n]\s*|["'\x60]\s*)`;
const GUARD_PATH = /\.claude[/\\]+(settings(\.local)?\.json|hooks)\b/i;

const BLOCK_RULES = [
  // Secrets
  { re: ENV_FILE_IN_TEXT, why: "accès à un fichier .env (secrets) — seul .env.example est autorisé" },
  { re: OLD_PC_SECRET, why: "accès aux secrets de la copie de l'ancien PC (.env, configuration/remote Git avec token)" },
  { re: /(^|[\s;&|(])(printenv|Get-ChildItem\s+env:|gci\s+env:|dir\s+env:|ls\s+env:)/i, why: "affichage des variables d'environnement (secrets)" },
  { re: /(^|[;&|(]\s*)env\s*($|[|;&>])/i, why: "affichage des variables d'environnement (secrets)" },
  { re: /\bgh\s+secret\b|\bvercel\s+env\b/i, why: "lecture ou modification de secrets distants" },
  // Schéma et base distante
  { re: /\bdb\s+push\b/i, why: "`db push` (prisma/supabase) : modification destructive du schéma" },
  { re: /\bmigrate\s+(dev|deploy|reset|resolve)\b/i, why: "migration Prisma (réservée à l'utilisateur)" },
  { re: /\bdb\s+(execute|pull|seed)\b/i, why: "`prisma db execute|pull|seed` : exécution SQL ou réécriture du schéma" },
  { re: /--(force-reset|accept-data-loss)\b/i, why: "option destructive Prisma" },
  { re: /\bsupabase\s+(db\s+(reset|push)|migration\s+(up|repair)|link|secrets)\b/i, why: "commande Supabase CLI modifiant la base ou les secrets" },
  // Déploiement et publication
  { re: new RegExp(`${CMD}((npx|bunx)\\s+(--yes\\s+|-y\\s+)?|pnpm\\s+(dlx\\s+)?|yarn\\s+(dlx\\s+)?|npm(\\.cmd)?\\s+(exec|x)\\s+(--\\s+)?)?vercel(\\.cmd|\\.exe)?(\\s|$)`, "i"), why: "commande Vercel (déploiement / variables de production)" },
  { re: /\bgit\b(?:(?!\bstash\b)[^;&|\n])*\spush\b/i, why: "git push (publication sur GitHub réservée à l'utilisateur)" },
  { re: /\bgh\s+(pr\s+(create|merge)|repo\s+(sync|create|delete|edit)|release\s+create|workflow\s+run|api\b[^;&|]*-X\s*(POST|PUT|PATCH|DELETE))/i, why: "publication GitHub via gh" },
  { re: /\bnpm(\.cmd)?\s+(publish|unpublish|deprecate)\b/i, why: "publication npm" },
  // Envois et paiements réels
  { re: /\bOUTBOUND_MODE\s*=\s*["']?live\b/i, why: "activation des envois réels (OUTBOUND_MODE=live) réservée à l'utilisateur" },
  { re: /\$env:OUTBOUND_MODE\s*=\s*["']?live/i, why: "activation des envois réels (OUTBOUND_MODE=live) réservée à l'utilisateur" },
  { re: /\bVERCEL_ENV\s*=\s*["']?production\b|\$env:VERCEL_ENV\s*=\s*["']?production/i, why: "simulation de l'environnement de production (VERCEL_ENV=production)" },
  { re: /(graph\.facebook\.com|api\.resend\.com|api\.stripe\.com|(eu\.|ca\.)?api\.ovh\.com|api\.openai\.com|ai-gateway\.vercel\.sh)/i, why: "appel direct à une API externe réelle (WhatsApp, emails, paiements, SMS ou IA)" },
  { re: /(https?:\/\/)?(www\.)?gestly\.fr\/api\//i, why: "appel d'une route de l'application de production" },
  { re: new RegExp(`${CMD}stripe(\\.exe)?\\s+(?!listen\\b|--version\\b|version\\b|help\\b)`, "i"), why: "commande Stripe CLI (opérations financières réservées à l'utilisateur ; seul `stripe listen` est autorisé)" },
  // Sauvegardes et garde-fous
  { re: /gestly-backups/i, why: "suppression ou déplacement d'une sauvegarde (réservé à l'utilisateur)", onlyIf: /(\brm\b|\brmdir\b|\brd\b|\bdel\b|\bmv\b|Remove-Item|Move-Item|Clear-Content|Set-Content|Out-File|>)/i },
  { re: /dangerously/i, why: "contournement des permissions" },
  {
    re: GUARD_PATH,
    why: "modification des garde-fous Claude Code (réservée à l'utilisateur)",
    onlyIf: /(>\s*["']?[^\s"']*\.claude[/\\]|\bsed\s+-i|\btee\b|\brm\b|\bmv\b|\bcp\b|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|\bdel\b|\bwrite|\bchmod\b|\bgit\s+(checkout|restore|reset|rm|mv)\b)/i,
  },
];

// ── Clients PostgreSQL : local autorisé, distant soumis à accord ───────────
const PG_TOOL = new RegExp(`${CMD}(?:&\\s*)?(?:["']?[^\\s"']*[/\\\\])?(psql|pg_restore|createdb|dropdb|pg_dump|pg_ctl|initdb)(\\.exe)?["']?(\\s|$)`, "i");
const PG_LOCAL = /\b(localhost|127\.0\.0\.1)\b|\[::1\]/i;
const PG_REMOTE_HINT = /(GESTLY_DB_URL|DATABASE_URL|DIRECT_URL|supabase\.(co|com)|\bPGHOST\b|pooler)/i;

function pgDecision(command) {
  const m = command.match(PG_TOOL);
  if (!m) return null;
  const tool = m[1].toLowerCase();
  if (/\s--?(version|help|V)\b/.test(command) && !PG_REMOTE_HINT.test(command)) return { decision: "allow" };
  if (tool === "pg_ctl" || tool === "initdb") return { decision: "allow" };
  // pg_restore --list : lit seulement le fichier de sauvegarde, sans base.
  if (tool === "pg_restore" && /\s(--list|-l)\b/.test(command) && !/\s(-d|--dbname)\b/.test(command)) return { decision: "allow" };
  if (PG_REMOTE_HINT.test(command)) {
    // pg_dump ne fait que lire : sauvegarde autorisée. Tout le reste vers une base distante → accord.
    if (tool === "pg_dump" && !/\b(psql|pg_restore|dropdb|createdb)\b/i.test(command)) return { decision: "allow" };
    return { decision: "ask", reason: `${tool} vers une base distante (Supabase) : accord requis` };
  }
  if (PG_LOCAL.test(command)) return { decision: "allow" };
  return { decision: "ask", reason: `${tool} sans cible locale explicite (localhost) : accord requis` };
}

// ── Actions locales à confirmer ────────────────────────────────────────────
const ASK_RULES = [
  { re: /\bgit\s+reset\s+[^;&|\n]*--hard\b/i, why: "git reset --hard (perte de modifications locales)" },
  { re: /\bgit\s+clean\s+[^;&|\n]*-[a-z]*f/i, why: "git clean -f (suppression de fichiers non suivis)" },
  { re: /\bgit\s+(checkout|restore)\s+(--\s+)?\.(\s|$)/i, why: "abandon de toutes les modifications locales" },
  { re: /\bgit\s+branch\s+[^;&|\n]*-D\b/, why: "suppression forcée d'une branche locale" },
  { re: /\bgit\s+stash\s+(drop|clear)\b/i, why: "suppression de travail mis de côté (stash)" },
  { re: /\bgit\s+(filter-branch|filter-repo|replace)\b/i, why: "réécriture de l'historique Git" },
];

const RECURSIVE_DELETE = /(\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b|Remove-Item\b[^;|&\n]*-Recurse|\brmdir\s+\/s|\brd\s+\/s|\bdel\s+\/s)/i;
const ABS_PATH = /(?<=^|[\s"'=(])(?:[A-Za-z]:[\\/]|\/[a-zA-Z]\/|~[\\/]?|\$HOME|\$env:USERPROFILE|\$env:TEMP|\$TEMP|\$env:TMP|\/)[^\s"';|&)]*/g;
const SAFE_DELETE_ROOTS = ["appdata/local/temp", "/tmp", "$env:temp", "$temp", "$env:tmp"];

function recursiveDeleteDecision(command) {
  if (!RECURSIVE_DELETE.test(command)) return null;
  const paths = (command.match(ABS_PATH) ?? []).map(norm).filter((p) => p !== "/" || /\s\/(\s|$)/.test(command));
  const outside = paths.filter((p) => !p.startsWith(PROJECT_ROOT) && !SAFE_DELETE_ROOTS.some((r) => p.includes(r)));
  if (outside.length || /(^|\s)\.\.([/\\]|\s|$)/.test(command)) {
    return { decision: "ask", reason: "suppression récursive hors du projet ou des dossiers temporaires" };
  }
  return null;
}

// ── SQL via le connecteur Supabase : lecture autorisée, le reste sur accord ─
function stripSql(sql) {
  return String(sql ?? "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}
const SQL_WRITE = /\b(insert|update|delete|merge|upsert|drop|alter|create|truncate|grant|revoke|comment|reindex|vacuum|cluster|copy|call|do|lock|refresh|import|security|reassign|discard|listen|notify|prepare|execute|set\s+(role|session))\b/i;
const SQL_READ_START = /^\s*(\(?\s*select|with|explain|show|values|table)\b/i;

export function isReadOnlySql(sql) {
  const s = stripSql(sql);
  const statements = s.split(";").map((x) => x.trim()).filter(Boolean);
  return statements.length > 0 && statements.every((st) => SQL_READ_START.test(st) && !SQL_WRITE.test(st) && !/\binto\b/i.test(st));
}

const DENIED_MCP = /^mcp__.*supabase.*__(apply_migration|deploy_edge_function|create_edge_function_secret|delete_branch|reset_branch|merge_branch|rebase_branch|create_branch|create_project|pause_project|restore_project)$/i;

export function evaluate(toolName, toolInput = {}) {
  const verdict = (decision, reason) => ({ decision, block: decision === "block", ...(reason ? { reason } : {}) });

  if (SHELL_TOOLS.has(toolName)) {
    const command = String(toolInput.command ?? "");
    for (const rule of BLOCK_RULES) {
      if (rule.re.test(command) && (!rule.onlyIf || rule.onlyIf.test(command))) return verdict("block", rule.why);
    }
    if (/prisma\/manual-migrations\/[^\s"']*\.sql/i.test(command) && /\bsupabase\b/i.test(command)) {
      return verdict("block", "script SQL de migration vers Supabase via la CLI (réservé à l'utilisateur)");
    }
    const pg = pgDecision(command);
    if (pg && pg.decision === "ask") return verdict("ask", pg.reason);
    for (const rule of ASK_RULES) {
      if (rule.re.test(command)) return verdict("ask", rule.why);
    }
    const del = recursiveDeleteDecision(command);
    if (del) return verdict(del.decision, del.reason);
    return verdict("allow");
  }

  if (FILE_TOOLS.has(toolName)) {
    const p = toolInput.file_path ?? toolInput.notebook_path ?? "";
    const base = String(p).replace(/\\/g, "/").split("/").pop() ?? "";
    if (ENV_BASENAME.test(base)) return verdict("block", "accès à un fichier .env (secrets) — seul .env.example est autorisé");
    if (OLD_PC_SECRET.test(String(p).replace(/\\/g, "/"))) return verdict("block", "accès aux secrets de la copie de l'ancien PC");
    if (WRITE_TOOLS.has(toolName) && /(^|\/)\.claude\/(settings(\.local)?\.json$|hooks\/)/i.test(String(p).replace(/\\/g, "/"))) {
      return verdict("block", "modification des garde-fous Claude Code (réservée à l'utilisateur)");
    }
    if (WRITE_TOOLS.has(toolName) && /gestly-backups/i.test(String(p))) {
      return verdict("block", "modification d'une sauvegarde (réservée à l'utilisateur)");
    }
    return verdict("allow");
  }

  if (toolName === "Grep" || toolName === "Glob") {
    const target = `${toolInput.path ?? ""} ${toolInput.glob ?? ""} ${toolName === "Glob" ? toolInput.pattern ?? "" : ""}`;
    if (toolName === "Grep" && (ENV_FILE_IN_TEXT.test(` ${target}`) || ENV_BASENAME.test(String(toolInput.path ?? "").replace(/\\/g, "/").split("/").pop() ?? ""))) {
      return verdict("block", "recherche dans un fichier .env (secrets)");
    }
    if (OLD_PC_SECRET.test(String(toolInput.path ?? "").replace(/\\/g, "/"))) return verdict("block", "recherche dans les secrets de la copie de l'ancien PC");
    return verdict("allow");
  }

  if (DENIED_MCP.test(toolName)) {
    return verdict("block", "outil Supabase modifiant l'infrastructure ou le schéma (réservé à l'utilisateur)");
  }
  if (/^mcp__.*supabase.*__execute_sql$/i.test(toolName)) {
    return isReadOnlySql(toolInput.query)
      ? verdict("allow")
      : verdict("ask", "SQL d'écriture ou de structure sur la base Supabase distante : accord requis");
  }
  return verdict("allow");
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const { decision, reason } = evaluate(input.tool_name, input.tool_input ?? {});
  if (decision === "block") {
    process.stderr.write(
      `Bloqué par le garde-fou Gestly (.claude/hooks/guard.mjs) : ${reason}. ` +
        "Voir CLAUDE.md ; cette action est réservée à l'utilisateur, qui doit l'exécuter lui-même.\n"
    );
    process.exit(2);
  }
  if (decision === "ask") {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: `Garde-fou Gestly : ${reason}.`,
      },
    }));
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`Garde-fou Gestly : erreur interne, action bloquée par sécurité (${err?.message ?? err}).\n`);
    process.exit(2);
  });
}
