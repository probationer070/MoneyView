import { AppShell } from "@/components/ui/AppShell";
import { HtmlLang } from "@/components/ui/HtmlLang";
import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// All three are SIL OFL 1.1 (commercial use, embedding and redistribution allowed); licence
// texts sit beside the files in app/fonts. Latin: Host Grotesk. Hangul: Pretendard (the Latin
// subset has no Hangul, so the stack falls through to it). Figures: Geist Mono.
const hostGrotesk = localFont({
  src: "./fonts/HostGrotesk-Variable-latin.woff2",
  variable: "--font-host-grotesk",
  weight: "300 800",
  display: "swap",
});

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

const geistMono = localFont({
  src: [
    { path: "./fonts/GeistMono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/GeistMono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/GeistMono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MoneyView Dashboard",
  description: "High-performance financial analytics platform",
};

import { AppProvider } from "@/components/providers/AppProvider";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${hostGrotesk.variable} ${pretendard.variable} ${geistMono.variable}`}>
      <body className="font-sans flex min-h-dvh justify-center">
        {/* Above the backend gate, so <html lang> follows the stored locale on the splash too. */}
        <HtmlLang />
        <AppProvider>
          <AppShell>{children}</AppShell>
        </AppProvider>
      </body>
    </html>
  );
}
