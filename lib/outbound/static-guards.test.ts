import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Garde-fou statique : tout nouveau chemin d'envoi externe ajouté au code
// serveur sans passer par le mode simulation fait échouer ce test. Il
// complète no-real-sends.test.ts (qui prouve le comportement des chemins
// existants) en empêchant d'en créer de nouveaux qui le contourneraient.

const ROOT = path.resolve(__dirname, "../..");
const SERVER_DIRS = ["app/api", "lib"];
const SERVER_FILES = ["middleware.ts", "instrumentation.ts"];

function listServerSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
    }
  };
  SERVER_DIRS.forEach(walk);
  return [...out, ...SERVER_FILES.filter((f) => fs.existsSync(path.join(ROOT, f)))];
}

const sources = listServerSources().map((file) => ({
  file,
  code: fs.readFileSync(path.join(ROOT, file), "utf8"),
}));

function filesMatching(re: RegExp): string[] {
  return sources.filter((s) => re.test(s.code)).map((s) => s.file).sort();
}

function codeOf(file: string): string {
  return sources.find((s) => s.file === file)!.code;
}

describe("garde-fous statiques des envois sortants", () => {
  it("analyse bien le code serveur", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("SDK Resend : importé et instancié uniquement dans lib/outbound/email.ts", () => {
    expect(filesMatching(/from ["']resend["']/)).toEqual(["lib/outbound/email.ts"]);
    expect(filesMatching(/new Resend\(/)).toEqual(["lib/outbound/email.ts"]);
    expect(codeOf("lib/outbound/email.ts")).toMatch(/isOutboundSimulated\(\)/);
  });

  it("emails : envoyés uniquement via sendEmail() (qui transforme une erreur Resend en exception)", () => {
    expect(filesMatching(/\.emails\.send\(/)).toEqual(["lib/outbound/email.ts"]);
    expect(filesMatching(/getEmailClient\(/)).toEqual(["lib/outbound/email.ts"]);
  });

  it("SDK OVH : chargé uniquement par lib/sms/ovh-client.ts, et chaque appelant est protégé", () => {
    expect(filesMatching(/require\(["']ovh["']\)|from ["']ovh["']/)).toEqual(["lib/sms/ovh-client.ts"]);
    const callers = filesMatching(/createOvhClient\(/).filter((f) => f !== "lib/sms/ovh-client.ts");
    expect(callers).toEqual(["lib/ovh-balance.ts", "lib/sms/ovh-provider.ts"]);
    for (const f of callers) expect(codeOf(f), f).toMatch(/isOutboundSimulated\(\)/);
  });

  it("fetch serveur : uniquement dans des fichiers protégés (liste fermée)", () => {
    const PROTECTED = [
      "app/api/devis/[id]/whatsapp/route.ts",
      "lib/whatsapp/media.ts",
      "lib/whatsapp/send.ts",
    ];
    // Hors périmètre de la simulation (documenté) : upload de logo vers le
    // Supabase Storage du projet, aucun envoi à un tiers.
    const OUT_OF_SCOPE = ["app/api/settings/logo/route.ts"];

    expect(filesMatching(/\bfetch\(/)).toEqual([...PROTECTED, ...OUT_OF_SCOPE].sort());
    for (const f of PROTECTED) expect(codeOf(f), f).toMatch(/isOutboundSimulated\(\)/);
  });

  it("URL de l'API Meta : seulement dans la configuration Graph et la route devis protégée", () => {
    expect(filesMatching(/graph\.facebook\.com/)).toEqual([
      "app/api/devis/[id]/whatsapp/route.ts",
      "lib/whatsapp/graph-config.ts",
    ]);
  });

  it("IA : appels du SDK `ai` uniquement derrière isAiConfigured()", () => {
    const aiCallers = filesMatching(/import\s*\{[^}]*\b(generateText|generateObject|streamText|streamObject|transcribe|embed)\b[^}]*\}\s*from\s*["']ai["']/);
    expect(aiCallers).toEqual([
      "app/api/ai/improve-message/route.ts",
      "lib/whatsapp/extraction.ts",
      "lib/whatsapp/transcription.ts",
    ]);
    for (const f of aiCallers) expect(codeOf(f), f).toMatch(/isAiConfigured\(\)/);
  });

  it("IA : fournisseur OpenAI direct construit uniquement dans lib/ai/config.ts, qui vérifie le mode", () => {
    expect(filesMatching(/from ["']@ai-sdk\/openai["']/)).toEqual(["lib/ai/config.ts"]);
    expect(codeOf("lib/ai/config.ts")).toMatch(/isOutboundSimulated\(\)/);
  });

  it("aucun autre client HTTP (axios, node:https, undici) dans le code serveur", () => {
    expect(filesMatching(/from ["'](axios|undici|node:https|https|node:http|http|got|node-fetch)["']/)).toEqual([]);
  });
});
