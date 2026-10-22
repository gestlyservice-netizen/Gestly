import { defineConfig } from "vitest/config";
import path from "path";

// Suite de tests ajoutée à l'étape 8 (garde-fous agent IA WhatsApp) : le
// projet n'avait jusqu'ici aucune infrastructure de test. Config minimale,
// alignée sur l'alias "@/*" déjà utilisé partout (tsconfig.json).
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
