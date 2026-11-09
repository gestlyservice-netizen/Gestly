import { defineConfig } from "vitest/config";
import path from "path";

// Recettes sur base PostgreSQL LOCALE et temporaire (scripts/recette/*.ps1).
// Exclues de la suite normale (`npm test`), qui reste entièrement simulée :
// elles exigent le serveur local créé par le script.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/recette/**/*.recette.ts"],
    // Étapes dépendantes les unes des autres : exécution dans l'ordre.
    sequence: { concurrent: false, shuffle: false },
    fileParallelism: false,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
