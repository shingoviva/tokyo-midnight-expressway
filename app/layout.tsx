import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AFTER MIDNIGHT — 首都高速・無限夜行",
  description:
    "東京の深夜の高速道路をリアルタイム生成し続ける、無限走行映像作品。",
  applicationName: "Tokyo After Midnight",
  category: "art",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
