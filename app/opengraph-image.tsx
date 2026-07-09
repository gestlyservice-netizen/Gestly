import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 84,
              height: 84,
              borderRadius: 20,
              background: "rgba(255,255,255,0.15)",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 52,
              color: "#ffffff",
              fontWeight: 700,
            }}
          >
            G
          </div>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: "#ffffff" }}>
            Gestly
          </div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 34,
            color: "#DBEAFE",
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          Devis et factures pour artisans et indépendants
        </div>
      </div>
    ),
    { ...size }
  );
}
