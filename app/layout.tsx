import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoutePass — 유럽 다도시 여행 일정·이동·출입국 확인",
  description: "유럽 나라와 도시를 순서대로 고르면 일정, 이동 방법, 운행 여부, 출입국 조건, 예산을 확인합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
