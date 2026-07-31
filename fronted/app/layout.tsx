import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Virtual Building Tour — AI 3D Platform",
  description: "Turn 2D floor plans into interactive 3D building tours with AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${mono.variable}`}>
      {/* suppressHydrationWarning: browser extensions (Grammarly, ColorZilla,
          Bitdefender…) inject attributes on <body> before React hydrates, which
          would otherwise trip a hydration mismatch. It only covers this element. */}
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
