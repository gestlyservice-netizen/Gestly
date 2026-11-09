import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  buildDevisEmail,
  defaultFactureEmail,
  documentEmailFrom,
  documentEmailSubject,
  raisonSociale,
  parseFactureEmailOverrides,
  replyToFrom,
  singleLine,
  FACTURE_EMAIL_LIMITS,
  type DevisEmailInput,
} from "@/lib/documents/document-email";

// Devis de la recette M4 : 3 × 0,10 € à 20 % ; 1,5 × 33,33 € à 10 %.
const devis: DevisEmailInput = {
  number: "DEV-2026-001",
  createdAt: new Date("2026-11-03T10:00:00Z"),
  validityDays: 30,
  notes: null,
  totalHT: 50.3,
  totalTVA: 5.06,
  totalTTC: 55.36,
  lines: [
    { description: "Prestation A", quantity: 3, unitPriceHT: 0.1, tvaRate: 20, totalHT: 0.3 },
    { description: "Prestation B", quantity: 1.5, unitPriceHT: 33.33, tvaRate: 10, totalHT: 50 },
  ],
  clientName: "Client Fictif",
  companyName: "Artisan Fictif",
  onlineUrl: "https://www.gestly.fr/print/devis/dev_a",
};

// Texte visible d'un fragment HTML (balises retirées, entités de base décodées).
const visible = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

describe("buildDevisEmail", () => {
  it("montants au centime au format français, dans le HTML et le texte", () => {
    const { html, text } = buildDevisEmail(devis);
    for (const out of [visible(html), text]) {
      expect(out).toContain("50,30 €");
      expect(out).toContain("5,06 €");
      expect(out).toContain("55,36 €");
    }
    // Lignes : quantité « 1,5 » (et non « 1.5 »), prix unitaires, taux.
    expect(visible(html)).toMatch(/Prestation B 1,5 33,33 € 10 % 50,00 €/);
    expect(visible(html)).toMatch(/Prestation A 3 0,10 € 20 % 0,30 €/);
  });

  it("objet, validité (jour de Paris), lien en ligne et mention du PDF joint", () => {
    const { subject, html, text } = buildDevisEmail(devis);
    expect(subject).toBe("Devis DEV-2026-001 — Artisan Fictif");
    expect(visible(html)).toContain("valable jusqu'au 03/12/2026");
    expect(visible(html)).toContain("ci-joint votre devis DEV-2026-001 (PDF)");
    expect(html).toContain('href="https://www.gestly.fr/print/devis/dev_a"');
    expect(text).toContain("https://www.gestly.fr/print/devis/dev_a");
    expect(text).toContain("valable jusqu'au 03/12/2026");
  });

  it("date affichée au jour de Paris : devis créé à 23 h 30 UTC = lendemain à Paris", () => {
    const { html } = buildDevisEmail({ ...devis, createdAt: new Date("2026-11-03T23:30:00Z") });
    expect(visible(html)).toContain("à compter du 04/11/2026");
  });

  it("[sécurité] toute donnée saisie est échappée : aucune balise injectée", () => {
    const injected = {
      ...devis,
      clientName: `<script>alert("client")</script>`,
      companyName: `<a href="https://pirate.example">Société</a>`,
      notes: `<img src=x onerror=alert(1)>\nNote 2`,
      lines: [{ ...devis.lines[0], description: `<b onmouseover="x">Ligne</b> & "co"` }],
      onlineUrl: `https://www.gestly.fr/print/devis/a"><script>x</script>`,
    };
    const { html, subject, text } = buildDevisEmail(injected);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b /i);
    expect(html).not.toContain('href="https://pirate.example"');
    expect(html).not.toContain('"><script');
    expect(html).toContain("&lt;script&gt;alert(&quot;client&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;b onmouseover=&quot;x&quot;&gt;Ligne&lt;/b&gt; &amp; &quot;co&quot;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // Seules les balises du gabarit subsistent : un seul lien (bouton) et le mailto.
    expect(html.match(/<a /g)).toHaveLength(2);
    // Le texte brut et l'objet ne sont pas du HTML : valeurs d'origine conservées.
    expect(text).toContain(`Bonjour <script>alert("client")</script>,`);
    expect(subject).toBe(`Devis DEV-2026-001 — <a href="https://pirate.example">Société</a>`);
  });

  it("notes affichées seulement si présentes", () => {
    expect(buildDevisEmail(devis).html).not.toContain(">Notes<");
    expect(visible(buildDevisEmail({ ...devis, notes: "Accès par la cour" }).html)).toContain("Accès par la cour");
  });

  it("objet sur une seule ligne même si la raison sociale contient un retour à la ligne", () => {
    expect(buildDevisEmail({ ...devis, companyName: "Artisan\r\nBcc: x@example.com" }).subject).toBe(
      "Devis DEV-2026-001 — Artisan Bcc: x@example.com"
    );
  });

  describe.each(["UTC", "Europe/Paris"])("serveur en %s", (tz) => {
    const savedTz = process.env.TZ;
    beforeEach(() => { process.env.TZ = tz; });
    afterEach(() => {
      if (savedTz === undefined) delete process.env.TZ;
      else process.env.TZ = savedTz;
    });

    it("[régression] devis créé à 0 h 30 à Paris : daté du jour de Paris dans l'email", () => {
      // 04/11/2026 0 h 30 CET = 03/11 23 h 30 UTC.
      const { html, text } = buildDevisEmail({ ...devis, createdAt: new Date("2026-11-03T23:30:00Z") });
      expect(visible(html)).toContain("à compter du 04/11/2026");
      expect(visible(html)).toContain("valable jusqu'au 04/12/2026");
      expect(text).toContain("valable jusqu'au 04/12/2026");
    });

    it("[régression] validité traversant l'heure d'hiver : un jour de moins sous UTC avant correction", () => {
      // 20/10/2026 0 h 30 CEST = 19/10 22 h 30 UTC ; + 30 jours = 19/11/2026.
      const { text } = buildDevisEmail({ ...devis, createdAt: new Date("2026-10-19T22:30:00Z") });
      expect(text).toContain("valable jusqu'au 19/11/2026");
    });
  });

  it("sans raison sociale : objet sans tiret, pied de page générique, pas de signature vide", () => {
    const { subject, html, text } = buildDevisEmail({ ...devis, companyName: "  " });
    expect(subject).toBe("Devis DEV-2026-001");
    expect(html).toContain("<strong>votre prestataire</strong> utilise");
    expect(text.endsWith("répondre à cet email.")).toBe(true);
  });
});

describe("raisonSociale / documentEmailSubject", () => {
  it("raison sociale des Paramètres en priorité, puis nom d'inscription", () => {
    expect(raisonSociale({ companyName: "Artisan Fictif SARL" }, { companyName: "Nom d'inscription" })).toBe("Artisan Fictif SARL");
    expect(raisonSociale({ companyName: "  " }, { companyName: "Nom d'inscription" })).toBe("Nom d'inscription");
    expect(raisonSociale(null, { companyName: " Nom d'inscription " })).toBe("Nom d'inscription");
    expect(raisonSociale(null, null)).toBe("");
  });

  it("[régression] objet : raison sociale, jamais « Gestly » par défaut", () => {
    expect(documentEmailSubject("Facture", "FAC-2026-001", "Artisan Fictif")).toBe("Facture FAC-2026-001 — Artisan Fictif");
    expect(documentEmailSubject("Facture", "FAC-2026-001", "")).toBe("Facture FAC-2026-001");
    expect(documentEmailSubject("Devis", "DEV-2026-001", "A\nB")).toBe("Devis DEV-2026-001 — A B");
  });
});

describe("defaultFactureEmail", () => {
  it("objet et message par défaut avec le TTC au format français", () => {
    const out = defaultFactureEmail({ number: "FAC-2026-001", totalTTC: 1740, clientName: "Client Fictif", companyName: "Artisan Fictif" });
    expect(out.subject).toBe("Facture FAC-2026-001 — Artisan Fictif");
    expect(out.message).toMatch(/^Bonjour Client Fictif,/);
    expect(out.message).toMatch(/facture FAC-2026-001 d'un montant de 1\s740,00 € TTC/);
    expect(out.message).toMatch(/Cordialement,\nArtisan Fictif$/);
  });

  it("sans raison sociale : « Cordialement. » sans signature vide", () => {
    const out = defaultFactureEmail({ number: "FAC-2026-001", totalTTC: 10, clientName: "C", companyName: "" });
    expect(out.subject).toBe("Facture FAC-2026-001");
    expect(out.message.endsWith("€ TTC.\n\nCordialement.")).toBe(true);
  });
});

describe("parseFactureEmailOverrides", () => {
  it("corps vide ou absent : aucun remplacement", () => {
    expect(parseFactureEmailOverrides({})).toEqual({ ok: true, to: null, subject: null, message: null });
    expect(parseFactureEmailOverrides(null)).toEqual({ ok: true, to: null, subject: null, message: null });
    expect(parseFactureEmailOverrides({ to: "  ", subject: "", message: " " })).toEqual({ ok: true, to: null, subject: null, message: null });
  });

  it("destinataire, objet et message valides : nettoyés et conservés", () => {
    expect(parseFactureEmailOverrides({ to: " compta@example.com ", subject: "Votre\nfacture", message: " Bonjour\n\nMerci " })).toEqual({
      ok: true, to: "compta@example.com", subject: "Votre facture", message: "Bonjour\n\nMerci",
    });
  });

  it.each([
    "pas-une-adresse",
    "a@example.com, b@example.com",
    "Nom <a@example.com>",
    "a@example.com\r\nBcc: b@example.com",
  ])("destinataire invalide refusé : %s", (to) => {
    const out = parseFactureEmailOverrides({ to });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Adresse email du destinataire invalide/);
  });

  it("types inattendus refusés", () => {
    expect(parseFactureEmailOverrides({ to: ["a@example.com"] }).ok).toBe(false);
    expect(parseFactureEmailOverrides({ subject: 12 }).ok).toBe(false);
    expect(parseFactureEmailOverrides({ message: { x: 1 } }).ok).toBe(false);
  });

  it("objet et message trop longs refusés", () => {
    expect(parseFactureEmailOverrides({ subject: "x".repeat(FACTURE_EMAIL_LIMITS.subject) }).ok).toBe(true);
    expect(parseFactureEmailOverrides({ subject: "x".repeat(FACTURE_EMAIL_LIMITS.subject + 1) }).ok).toBe(false);
    expect(parseFactureEmailOverrides({ message: "x".repeat(FACTURE_EMAIL_LIMITS.message + 1) }).ok).toBe(false);
  });
});

describe("expéditeur et adresse de réponse", () => {
  const saved = process.env.RESEND_FROM_EMAIL;
  afterEach(() => {
    if (saved === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = saved;
  });

  it("expéditeur : RESEND_FROM_EMAIL, sinon l'adresse de test Resend", () => {
    delete process.env.RESEND_FROM_EMAIL;
    expect(documentEmailFrom()).toBe("Gestly <onboarding@resend.dev>");
    process.env.RESEND_FROM_EMAIL = "Gestly <devis@example.com>";
    expect(documentEmailFrom()).toBe("Gestly <devis@example.com>");
  });

  it("réponse vers l'email professionnel de l'artisan, seulement s'il est valide", () => {
    expect(replyToFrom("artisan@example.com")).toEqual({ replyTo: "artisan@example.com" });
    expect(replyToFrom("invalide")).toEqual({});
    expect(replyToFrom(null)).toEqual({});
    expect(replyToFrom(undefined)).toEqual({});
  });

  it("singleLine aplatit retours à la ligne et espaces", () => {
    expect(singleLine("  a\r\n\tb   c ")).toBe("a b c");
  });
});

describe("[régression] email du devis sur téléphone", () => {
  it("style mobile présent (marges réduites, tableau compact) et largeur des totaux bornée", () => {
    const { html } = buildDevisEmail(devis);
    expect(html).toContain("@media only screen and (max-width: 520px)");
    expect(html).toContain('class="g-card"');
    expect(html).toContain('class="g-lines"');
    expect(html).toMatch(/class="g-totals"[^>]*max-width:100%/);
  });
});
