import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP, Oswald } from "next/font/google";
import "./globals.css";

const bodyFont = Noto_Sans_JP({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
});

const displayFont = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SCOREBOOK AI | 学童野球スコアブック読取",
  description: "早稲田式スコアブックをスマホで撮影してAI解析・成績管理するアプリ",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
  other: {
    robots: "noindex, nofollow",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0F172A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={`${bodyFont.variable} ${displayFont.variable} h-full`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
