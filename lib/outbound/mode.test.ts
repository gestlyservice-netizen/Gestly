import { describe, it, expect } from "vitest";
import { getOutboundMode, getOutboundDiagnostics, isOutboundSimulated, isOutboundDisabled, maskRecipient } from "@/lib/outbound/mode";

describe("getOutboundMode — règle par défaut", () => {
  it("simulation par défaut sans aucune variable (poste local, tests)", () => {
    expect(getOutboundMode({})).toBe("simulate");
  });

  it("simulation en local même avec de vraies clés et NODE_ENV=production (`next start` local)", () => {
    expect(
      getOutboundMode({
        NODE_ENV: "production",
        WHATSAPP_TOKEN: "fake",
        OVH_APP_KEY: "fake",
        RESEND_API_KEY: "fake",
        OPENAI_API_KEY: "fake",
      })
    ).toBe("simulate");
  });

  it("simulation sur les déploiements Preview Vercel", () => {
    expect(getOutboundMode({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe("simulate");
  });

  it("live uniquement en production Vercel", () => {
    expect(getOutboundMode({ VERCEL: "1", VERCEL_ENV: "production" })).toBe("live");
  });
});

describe("getOutboundMode — forçage explicite OUTBOUND_MODE", () => {
  it("OUTBOUND_MODE=simulate coupe les envois même en production", () => {
    expect(getOutboundMode({ VERCEL_ENV: "production", OUTBOUND_MODE: "simulate" })).toBe("simulate");
  });

  it("OUTBOUND_MODE=live autorise les envois réels hors production (opt-in explicite)", () => {
    expect(getOutboundMode({ OUTBOUND_MODE: "live" })).toBe("live");
  });

  it("insensible à la casse et aux espaces", () => {
    expect(getOutboundMode({ OUTBOUND_MODE: "  Simulate " , VERCEL_ENV: "production" })).toBe("simulate");
  });

  it("valeur inconnue ignorée : repli sur la règle par défaut (jamais live par erreur en local)", () => {
    expect(getOutboundMode({ OUTBOUND_MODE: "lvie" })).toBe("simulate");
    expect(getOutboundMode({ OUTBOUND_MODE: "true" })).toBe("simulate");
    expect(getOutboundMode({ OUTBOUND_MODE: "lvie", VERCEL_ENV: "production" })).toBe("live");
  });

  it("isOutboundSimulated suit getOutboundMode", () => {
    expect(isOutboundSimulated({})).toBe(true);
    expect(isOutboundSimulated({ VERCEL_ENV: "production" })).toBe(false);
  });
});

describe("getOutboundMode — robustesse aux mauvaises configurations", () => {
  it("VERCEL_ENV=production importé en local (`next dev`) : reste en simulation", () => {
    expect(getOutboundMode({ NODE_ENV: "development", VERCEL_ENV: "production", VERCEL: "1" })).toBe("simulate");
  });

  it("VERCEL_ENV=production sous Vitest : reste en simulation", () => {
    expect(getOutboundMode({ NODE_ENV: "test", VERCEL_ENV: "production" })).toBe("simulate");
  });

  it("NODE_ENV absent ou fantaisiste : la décision ne dépend que de VERCEL_ENV", () => {
    expect(getOutboundMode({ NODE_ENV: "staging" })).toBe("simulate");
    expect(getOutboundMode({ NODE_ENV: "staging", VERCEL_ENV: "production" })).toBe("live");
  });

  it("OUTBOUND_MODE vide ou composé d'espaces : ignoré", () => {
    expect(getOutboundMode({ OUTBOUND_MODE: "" })).toBe("simulate");
    expect(getOutboundMode({ OUTBOUND_MODE: "   ", VERCEL_ENV: "production" })).toBe("live");
  });
});

describe("getOutboundDiagnostics — une production mal configurée n'est jamais silencieuse", () => {
  it("poste local standard : aucune anomalie", () => {
    expect(getOutboundDiagnostics({ NODE_ENV: "development", APP_URL: "http://localhost:3000" })).toEqual({
      mode: "simulate",
      problems: [],
      notes: [],
    });
  });

  it("production Vercel correcte : live, aucune anomalie", () => {
    const d = getOutboundDiagnostics({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "production" });
    expect(d).toMatchObject({ mode: "live", problems: [] });
  });

  it("build de production sur Vercel SANS VERCEL_ENV : simulation SIGNALÉE comme problème", () => {
    const d = getOutboundDiagnostics({ NODE_ENV: "production", VERCEL: "1" });
    expect(d.mode).toBe("simulate");
    expect(d.problems.join()).toMatch(/Production probable/);
  });

  it("URL de production configurée sans variables Vercel : simulation SIGNALÉE", () => {
    const d = getOutboundDiagnostics({ NODE_ENV: "production", APP_URL: "https://www.gestly.fr" });
    expect(d.mode).toBe("simulate");
    expect(d.problems).toHaveLength(1);
  });

  it("bêta privée (OUTBOUND_MODE=simulate en production) : affiché, envois de l'artisan refusés", () => {
    const env = { NODE_ENV: "production", VERCEL_ENV: "production", OUTBOUND_MODE: "simulate" };
    const d = getOutboundDiagnostics(env);
    expect(d.mode).toBe("simulate");
    expect(d.notes.join()).toMatch(/AUCUN envoi réel/);
    expect(isOutboundDisabled(env)).toBe(true);
    // Local et Preview : simulation silencieuse, parcours testables.
    expect(isOutboundDisabled({ NODE_ENV: "development", OUTBOUND_MODE: "simulate" })).toBe(false);
    expect(isOutboundDisabled({ NODE_ENV: "production", VERCEL_ENV: "preview", OUTBOUND_MODE: "simulate" })).toBe(false);
    expect(isOutboundDisabled({ NODE_ENV: "production", VERCEL_ENV: "production" })).toBe(false);
  });

  it("OUTBOUND_MODE avec une faute de frappe : SIGNALÉ, et jamais live en local", () => {
    const local = getOutboundDiagnostics({ NODE_ENV: "development", OUTBOUND_MODE: "lvie" });
    expect(local.mode).toBe("simulate");
    expect(local.problems.join()).toMatch(/non reconnu/);
    const prod = getOutboundDiagnostics({ NODE_ENV: "production", VERCEL_ENV: "production", OUTBOUND_MODE: "simluate" });
    expect(prod.mode).toBe("live");
    expect(prod.problems.join()).toMatch(/non reconnu/);
  });

  it("Preview Vercel : simulation attendue, simple note", () => {
    const d = getOutboundDiagnostics({ NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", APP_URL: "https://www.gestly.fr" });
    expect(d).toMatchObject({ mode: "simulate", problems: [] });
    expect(d.notes.join()).toMatch(/Preview/);
  });

  it("OUTBOUND_MODE=live hors production : envois réels notés", () => {
    const d = getOutboundDiagnostics({ NODE_ENV: "development", OUTBOUND_MODE: "live" });
    expect(d.mode).toBe("live");
    expect(d.notes.join()).toMatch(/RÉELS/);
  });
});

describe("maskRecipient — aucune donnée complète dans les logs", () => {
  it("masque un numéro en gardant les 4 derniers chiffres", () => {
    expect(maskRecipient("+33612345678")).toBe("********5678");
  });

  it("masque une adresse email en gardant le domaine", () => {
    expect(maskRecipient("jean.dupont@example.com")).toBe("je***@example.com");
  });

  it("gère l'absence de destinataire", () => {
    expect(maskRecipient(null)).toBeNull();
    expect(maskRecipient("")).toBeNull();
  });
});
