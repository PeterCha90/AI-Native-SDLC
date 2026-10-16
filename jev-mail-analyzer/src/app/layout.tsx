import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "JEV 메일 분석기",
  description:
    "TypeSafe AI의 JEV 모델로 실시간 Gmail 받은편지함 메일을 카테고리별로 분석하는 데모입니다.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="bg-bg text-text font-sans antialiased min-h-screen">
        {children}
      </body>
    </html>
  );
}
