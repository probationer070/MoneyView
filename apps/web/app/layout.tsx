import { Sidebar } from "@/components/ui/Sidebar";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    <html lang="en">
      <body className={`${inter.variable} font-sans flex min-h-screen`}>
        <AppProvider>
          <Sidebar />
          <main className="flex-1 ml-64 p-20">
            {children}
          </main>
        </AppProvider>
      </body>
    </html>
  );
}
