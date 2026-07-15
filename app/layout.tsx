import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

const title = "AFTER MIDNIGHT — 首都高速・無限夜行";
const description =
  "東京の深夜の高速道路をリアルタイム生成し続ける、無限走行映像作品。";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#010407",
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "tokyo-after-midnight.shingo5555.chatgpt.site";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  let origin: URL;
  try {
    origin = new URL(`${protocol}://${host}`);
  } catch {
    origin = new URL("https://tokyo-after-midnight.shingo5555.chatgpt.site");
  }
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title,
    description,
    applicationName: "Tokyo After Midnight",
    category: "art",
    metadataBase: origin,
    openGraph: {
      title,
      description,
      type: "website",
      images: [
        {
          url: socialImage,
          width: 1672,
          height: 941,
          alt: "深夜の東京高速道路を走る AFTER MIDNIGHT",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

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
