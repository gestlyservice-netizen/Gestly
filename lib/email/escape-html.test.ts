import { describe, it, expect } from "vitest";
import { escapeHtml } from "@/lib/email/escape-html";

describe("escapeHtml", () => {
  it("échappe les 5 caractères spéciaux HTML", () => {
    expect(escapeHtml(`<a href="x" title='y'>A & B</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;A &amp; B&lt;/a&gt;"
    );
  });

  it("neutralise une balise script ou image", () => {
    const out = escapeHtml(`<script>alert(1)</script><img src=x onerror=alert(1)>`);
    expect(out).not.toMatch(/[<>]/);
  });

  it("n'échappe pas deux fois ce qui l'est déjà (& devient &amp;)", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("laisse intact le texte ordinaire, accents et retours à la ligne compris", () => {
    expect(escapeHtml("Pose d'évier\n2e étage")).toBe("Pose d&#39;évier\n2e étage");
    expect(escapeHtml("Société Martin")).toBe("Société Martin");
  });

  it("null / undefined → chaîne vide ; nombres convertis", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(55.36)).toBe("55.36");
  });
});
