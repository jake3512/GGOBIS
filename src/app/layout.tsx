import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoL 조합 추천",
  description: "매치 데이터 기반 리그 오브 레전드 챔피언 조합 추천",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
