import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { GlobalShortcuts } from "@/components/global-shortcuts";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Barlow_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#c51230",
};

export const metadata: Metadata = {
  title: "NUGuessr",
  description: "Guess where on Northeastern's Boston campus each photo was taken.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${display.variable} bg-background font-sans text-foreground antialiased`}
      >
        {children}
        <GlobalShortcuts />
      </body>
    </html>
  );
}
