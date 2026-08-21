import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoL 라인 카운터 / 바텀 듀오 조회",
  description: "op.gg, u.gg, lolalytics 등 여러 사이트의 실시간 통계로 보는 라인 카운터와 바텀 듀오 시너지",
};

export const viewport: Viewport = {
  themeColor: "#0f1115",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
