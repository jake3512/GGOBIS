import { ImageResponse } from "next/og";

// App Router's apple-icon convention — becomes the icon iOS shows when this
// app is added to the home screen (see layout.tsx's appleWebApp meta). Apple
// applies its own rounded-corner mask on top, so this fills the full square
// with no border-radius/transparency of its own — a half-rounded icon under
// iOS's mask looks wrong.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          color: "#5b9bff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 78, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1 }}>
          GG
        </div>
        <div style={{ display: "flex", fontSize: 32, fontWeight: 700, letterSpacing: "-0.01em", lineHeight: 1, marginTop: 6 }}>
          obis
        </div>
      </div>
    ),
    { ...size },
  );
}
