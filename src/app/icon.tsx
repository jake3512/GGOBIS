import { ImageResponse } from "next/og";

// App Router's icon convention — Next.js renders this at build/request time
// and serves it as the site favicon, replacing the generic default
// favicon.ico (which stays in place as a legacy fallback for browsers that
// specifically request /favicon.ico). Colors match globals.css's
// --background/--accent tokens so the tab icon reads as the same app.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          background: "#0b0d11",
          borderRadius: 7,
          color: "#5b9bff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1 }}>
          GG
        </div>
        <div style={{ display: "flex", fontSize: 7, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}>
          obis
        </div>
      </div>
    ),
    { ...size },
  );
}
