import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

const description =
  "Shim migrates AI SDK 6 apps to 7 and opens a tested pull request. The official codemod does the renames. Shim fixes the changes that still compile but return different data.";

export const metadata: Metadata = {
  title: "Shim — Your tests pass. Your behavior changed.",
  description,
  openGraph: {
    title: "Shim — Your tests pass. Your behavior changed.",
    description,
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0C0D0E",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
