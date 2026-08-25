import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GGOBIS · 꼬비스",
  description: "op.gg, u.gg, lolalytics 등 여러 사이트의 실시간 통계로 보는 LoL 라인 카운터 · 듀오 시너지 · 픽 추천 · 빌드",
  appleWebApp: {
    capable: true,
    title: "GGOBIS",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
