"use client";

import { useEffect, useState, useTransition } from "react";

interface CheckResult {
  creditsLeft: number;
  lastChecked: string;
  alertsSent: number[];
}

interface Alert {
  id: string;
  creditsLeft: number;
  threshold: number;
  alertSentAt: string;
}

export default function OvhBalancePage() {
  const [result, setResult]   = useState<CheckResult | null>(null);
  const [alerts, setAlerts]   = useState<Alert[]>([]);
  const [error, setError]     = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function check() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/ovh-balance/check");
        if (res.status === 401) { setError("Non autorisé"); return; }
        if (!res.ok) { setError("Erreur API"); return; }
        const data: CheckResult = await res.json();
        setResult(data);
      } catch {
        setError("Erreur réseau");
      }
    });
  }

  async function loadAlerts() {
    try {
      const res = await fetch("/api/admin/ovh-balance/history");
      if (res.ok) setAlerts(await res.json());
    } catch { /* silent */ }
  }

  useEffect(() => { check(); loadAlerts(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const credits = result?.creditsLeft ?? null;
  const color   = credits === null ? "#64748b"
    : credits < 100  ? "#dc2626"
    : credits < 500  ? "#d97706"
    : "#16a34a";

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Solde SMS OVH</h1>
      <p style={{ color: "#64748b", marginBottom: 32, fontSize: 14 }}>
        Surveillance du pool de crédits SMS prépayés global
      </p>

      {/* Solde actuel */}
      <div style={{
        background: "#f8fafc", border: "1px solid #e2e8f0",
        borderRadius: 12, padding: "24px 32px", marginBottom: 24,
      }}>
        {error ? (
          <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>CRÉDITS RESTANTS</div>
            <div style={{ fontSize: 48, fontWeight: 800, color, lineHeight: 1 }}>
              {credits === null ? "…" : credits}
            </div>
            {result && (
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
                Vérifié le {new Date(result.lastChecked).toLocaleString("fr-FR")}
                {result.alertsSent.length > 0 && (
                  <span style={{ color: "#d97706", marginLeft: 8 }}>
                    · alerte envoyée (seuil {result.alertsSent.join(", ")})
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <button
        onClick={check}
        disabled={pending}
        style={{
          background: "#1e40af", color: "#fff", border: "none",
          borderRadius: 8, padding: "10px 20px", fontSize: 14,
          fontWeight: 600, cursor: pending ? "not-allowed" : "pointer",
          opacity: pending ? 0.7 : 1, marginBottom: 40,
        }}
      >
        {pending ? "Vérification…" : "Vérifier maintenant"}
      </button>

      {/* Historique alertes */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Historique des alertes</h2>
      {alerts.length === 0 ? (
        <p style={{ color: "#94a3b8", fontSize: 14 }}>Aucune alerte envoyée.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f1f5f9", textAlign: "left" }}>
              <th style={{ padding: "8px 12px" }}>Date</th>
              <th style={{ padding: "8px 12px" }}>Crédits au moment de l&apos;alerte</th>
              <th style={{ padding: "8px 12px" }}>Seuil déclenché</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={{ padding: "8px 12px", color: "#475569" }}>
                  {new Date(a.alertSentAt).toLocaleString("fr-FR")}
                </td>
                <td style={{ padding: "8px 12px", fontWeight: 600, color: a.creditsLeft < 100 ? "#dc2626" : "#d97706" }}>
                  {a.creditsLeft}
                </td>
                <td style={{ padding: "8px 12px", color: "#64748b" }}>
                  {a.threshold === 100 ? "🚨 critique &lt; 100" : "⚠️ bas &lt; 500"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
