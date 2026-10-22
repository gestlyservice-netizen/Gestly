export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    // Visible au démarrage du serveur : "simulate" partout hors production
    // Vercel (voir lib/outbound/mode.ts). Une configuration incohérente
    // (ex. production en simulation) est signalée en erreur et à Sentry.
    const { getOutboundDiagnostics } = await import("./lib/outbound/mode");
    const { mode, problems, notes } = getOutboundDiagnostics();
    console.info(`[outbound] mode=${mode}${notes.length ? ` (${notes.join(" ; ")})` : ""}`);
    if (problems.length > 0) {
      const Sentry = await import("@sentry/nextjs");
      for (const problem of problems) {
        console.error(`[outbound] CONFIGURATION INCOHÉRENTE : ${problem}`);
        Sentry.captureMessage(`[outbound] ${problem}`, "error");
      }
    }
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
